import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
import type { Asset } from '../src/shared/types';

const USER_AGENT = 'Fieldmark/0.1 (engineering document research; public resources only)';
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 5;
const MiB = 1024 * 1024;
const mediaTypes: Record<string, string> = {
  pdf: 'application/pdf', dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf',
  rfa: 'application/octet-stream', rvt: 'application/octet-stream', ifc: 'application/x-step',
  step: 'application/step', iges: 'model/iges', zip: 'application/zip',
};
const extensions: Record<string, string> = { pdf: 'pdf', dwg: 'dwg', dxf: 'dxf', rfa: 'rfa', rvt: 'rvt', ifc: 'ifc', step: 'step', stp: 'step', iges: 'iges', igs: 'iges', zip: 'zip' };
const executableExtensions = new Set(['exe', 'com', 'dll', 'msi', 'msp', 'scr', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'hta', 'lnk', 'url', 'reg', 'jar', 'sh', 'app', 'dmg']);

function aborted(signal?: AbortSignal): void { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Research canceled.'); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Research canceled.'));
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  aborted(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(signal?.reason instanceof Error ? signal.reason : new Error('Research canceled.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

/** Only globally routable unicast addresses are eligible, including after IPv4 mapping. */
export function assertPublicAddress(address: string): void {
  let parsed: ReturnType<typeof ipaddr.parse>;
  try { parsed = ipaddr.process(address.replace(/^\[|\]$/g, '')); }
  catch { throw new Error('The destination did not resolve to a valid public IP address.'); }
  if (parsed.range() !== 'unicast' || (parsed.kind() === 'ipv6' && (parsed.toByteArray()[0] & 0xe0) !== 0x20)) throw new Error('Local, private, multicast, and reserved network addresses are blocked.');
}

/** WHATWG URL parsing also normalizes integer, octal, and hexadecimal IPv4 forms. */
export function parsePublicUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Enter an absolute public HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public HTTP and HTTPS resources are supported.');
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Only standard web ports 80 and 443 are allowed.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa') || host === 'metadata.google.internal') {
    throw new Error('Local and internal hostnames are blocked.');
  }
  if (isIP(host)) assertPublicAddress(host);
  url.hash = '';
  return url;
}

export function redirectUrl(current: string, location: string): URL {
  return parsePublicUrl(new URL(location, current).href);
}

function extensionOf(name: string): string { return path.posix.extname(name.replace(/\\/g, '/')).slice(1).toLowerCase(); }
export function safeFilename(name: string, kind?: string): string {
  let cleaned = name.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 150);
  if (!cleaned) cleaned = 'equipment-document';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`;
  if (kind && extensions[extensionOf(cleaned)] !== kind) cleaned = `${cleaned}.${kind}`;
  return cleaned;
}

function suggestedName(url: string, headers: IncomingHttpHeaders): string {
  const disposition = headers['content-disposition'] ?? '';
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  const ordinary = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(disposition);
  let name = utf8?.[1] ?? ordinary?.[1] ?? ordinary?.[2];
  if (!name) name = new URL(url).pathname.split('/').pop() || 'equipment-document';
  try { return decodeURIComponent(name.trim()); } catch { return name.trim(); }
}

export interface AssetClassification { kind: string; mediaType: string; note: string; }
export function classifyAsset(data: Buffer, name: string, contentType = ''): AssetClassification {
  const prefix = data.subarray(0, 8192).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  const ext = extensionOf(name);
  if (executableExtensions.has(ext) || data.subarray(0, 2).equals(Buffer.from('MZ')) || data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || prefix.startsWith('#!') || /(?:javascript|x-msdownload|x-executable|x-dosexec)/i.test(contentType)) {
    throw new Error('Executable and script downloads are not supported.');
  }
  if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b|<script\b|<!--)/i.test(prefix) || /(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
    throw new Error('The server returned an HTML page, not an equipment file. It may be an access or sign-in page.');
  }
  let kind = 'unknown';
  let note = 'The file format could not be verified; no compatibility is inferred from its filename.';
  if (/^%PDF-\d\.\d/.test(prefix.slice(0, 32))) kind = 'pdf';
  else if (/^AC10\d{2}/.test(data.subarray(0, 6).toString('ascii'))) kind = 'dwg';
  else if (data.subarray(0, 22).toString('ascii').startsWith('AutoCAD Binary DXF\r\n\x1a') || /^\s*0\s*\r?\n\s*SECTION\b/i.test(prefix)) kind = 'dxf';
  else if (data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) && ['rfa', 'rvt'].includes(ext)) {
    kind = ext;
    note = 'Compound-file signature and Revit filename detected. Revit content, version, product match, and compatibility are unverified.';
  } else if (/^ISO-10303-21\s*;/i.test(prefix)) {
    kind = /FILE_SCHEMA\s*\(\s*\(\s*['"]IFC/i.test(prefix) ? 'ifc' : 'step';
  } else if (prefix.split(/\r?\n/).slice(0, 10).some(line => /^.{72}S\s*\d{1,7}\s*$/.test(line))) kind = 'iges';
  else if (data.length >= 4 && ['504b0304', '504b0506', '504b0708'].includes(data.subarray(0, 4).toString('hex'))) {
    kind = 'zip';
    note = 'ZIP archive signature detected. Its contents have not been extracted, executed, or inspected.';
  }
  if (extensions[ext] && kind !== 'unknown' && extensions[ext] !== kind) throw new Error(`The file signature (${kind}) does not match its filename (${ext}).`);
  if (kind !== 'unknown' && !['rfa', 'rvt', 'zip'].includes(kind)) note = `${kind.toUpperCase()} file signature detected. Product suitability and document contents still require review.`;
  return { kind, mediaType: mediaTypes[kind] ?? 'application/octet-stream', note };
}

interface ResponseData {
  url: string; status: number; headers: IncomingHttpHeaders; body: Buffer;
  truncated: boolean; declaredLength?: number;
}
type Robots = ReturnType<typeof robotsParser>;
interface RobotsPolicy { expires: number; robots?: Robots; denied?: string; }
type HtmlNode = DefaultTreeAdapterMap['node'];
type HtmlElement = DefaultTreeAdapterMap['element'];
function isElement(node: HtmlNode): node is HtmlElement { return 'tagName' in node; }
function children(node: HtmlNode): HtmlNode[] { return 'childNodes' in node ? node.childNodes : []; }
function* walk(node: HtmlNode): Generator<HtmlNode> {
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    yield current;
    const nested = children(current);
    for (let index = nested.length - 1; index >= 0; index--) pending.push(nested[index]);
  }
}
function attribute(node: HtmlElement, name: string): string | undefined { return node.attrs.find(attr => attr.name === name)?.value; }
function firstTag(node: HtmlNode, name: string): HtmlElement | undefined {
  for (const element of walk(node)) if (isElement(element) && element.tagName === name) return element;
  return undefined;
}
const omittedTags = new Set(['script', 'style', 'nav', 'header', 'footer', 'svg', 'noscript', 'form', 'template']);
const blockTags = new Set(['br', 'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'tr', 'section']);
function htmlText(node: HtmlNode, clean = false): string {
  const parts: string[] = [];
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    if ('value' in current) { parts.push(current.value); continue; }
    if (isElement(current) && clean && omittedTags.has(current.tagName)) continue;
    if (clean && isElement(current) && blockTags.has(current.tagName)) parts.push('\n');
    const nested = children(current);
    for (let index = nested.length - 1; index >= 0; index--) pending.push(nested[index]);
  }
  return parts.join('');
}

export class ResearchTools {
  private readonly assetDirectory: string;
  private readonly maxDownloadMb: () => number;
  private readonly nextRequest = new Map<string, number>();
  private readonly lastRequest = new Map<string, number>();
  private readonly hostDelay = new Map<string, number>();
  private readonly robotsCache = new Map<string, RobotsPolicy>();

  constructor(options: { assetDirectory: string; maxDownloadMb: () => number }) {
    this.assetDirectory = path.resolve(options.assetDirectory);
    this.maxDownloadMb = options.maxDownloadMb;
  }

  private downloadLimit(): number {
    const mb = this.maxDownloadMb();
    return Math.floor(Math.min(250, Math.max(1, Number.isFinite(mb) ? mb : 50)) * MiB);
  }

  private async throttle(url: URL, signal?: AbortSignal): Promise<void> {
    const key = url.hostname.toLowerCase();
    const gap = this.hostDelay.get(key) ?? 600;
    const now = Date.now();
    const start = Math.max(now, this.nextRequest.get(key) ?? 0, (this.lastRequest.get(key) ?? 0) + gap);
    this.nextRequest.set(key, start + gap);
    await delay(start - now, signal);
    this.lastRequest.set(key, Date.now());
  }

  /** Every connection uses the address just validated, never a second resolver lookup. */
  private async request(url: URL, maxBytes: number, signal?: AbortSignal): Promise<ResponseData> {
    aborted(signal);
    await this.throttle(url, signal);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason ?? new Error('Research canceled.'));
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('The public server did not finish responding within 25 seconds.')), REQUEST_TIMEOUT_MS);
    try {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await abortable(dns.lookup(host, { all: true, verbatim: true }), controller.signal);
      if (!addresses.length) throw new Error('The host has no public IP addresses.');
      for (const result of addresses) assertPublicAddress(result.address);
      const chosen = addresses.find(item => item.family === 4) ?? addresses[0];
      return await new Promise<ResponseData>((resolve, reject) => {
        let settled = false;
        const finish = (result: ResponseData) => { if (!settled) { settled = true; resolve(result); } };
        const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
        const lookup = ((_hostname: unknown, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) callback(null, [chosen]); else callback(null, chosen.address, chosen.family);
        }) as NonNullable<http.RequestOptions['lookup']>;
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, {
          method: 'GET', agent: false, family: chosen.family, lookup, signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Accept-Encoding': 'identity' },
        }, res => {
          const status = res.statusCode ?? 0;
          const declared = Number(res.headers['content-length']);
          const declaredLength = Number.isSafeInteger(declared) && declared >= 0 ? declared : undefined;
          const result = (body: Buffer, truncated: boolean): ResponseData => ({ url: url.href, status, headers: res.headers, body, truncated, declaredLength });
          if ([301, 302, 303, 307, 308].includes(status)) { finish(result(Buffer.alloc(0), false)); res.destroy(); return; }
          if (res.headers['content-encoding'] && res.headers['content-encoding'].toLowerCase() !== 'identity') { fail(new Error('The server ignored the uncompressed response request; this response cannot be safely inspected.')); res.destroy(); return; }
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on('data', (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const remaining = maxBytes - bytes;
            if (buffer.length > remaining) {
              if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
              finish(result(Buffer.concat(chunks, maxBytes), true));
              res.destroy();
              return;
            }
            chunks.push(buffer); bytes += buffer.length;
          });
          res.on('end', () => finish(result(Buffer.concat(chunks, bytes), false)));
          res.on('error', fail);
          res.on('aborted', () => fail(new Error('The server closed the file before the download completed.')));
        });
        req.on('error', fail);
        req.end();
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private async fetch(url: string, maxBytes: number, signal?: AbortSignal, checkRobots = true): Promise<ResponseData> {
    let current = parsePublicUrl(url);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      aborted(signal);
      if (checkRobots) await this.ensureRobots(current, signal);
      const result = await this.request(current, maxBytes, signal);
      if (![301, 302, 303, 307, 308].includes(result.status)) return result;
      if (!result.headers.location) throw new Error('The server redirected without a destination.');
      if (redirect === MAX_REDIRECTS) throw new Error('The public resource exceeded the five-redirect limit.');
      current = redirectUrl(current.href, result.headers.location);
    }
    throw new Error('Redirect limit reached.');
  }

  private async ensureRobots(url: URL, signal?: AbortSignal): Promise<void> {
    const key = url.origin;
    let policy = this.robotsCache.get(key);
    if (!policy || policy.expires <= Date.now()) {
      const robotsUrl = new URL('/robots.txt', url.origin).href;
      try {
        const result = await this.fetch(robotsUrl, 512 * 1024, signal, false);
        policy = { expires: Date.now() + 10 * 60 * 1000 };
        if (result.status === 404 || result.status === 410) {
          // A missing robots file does not impose crawl rules.
        } else if (result.status >= 200 && result.status < 300 && !result.truncated && !/^\s*(?:<!doctype|<html)/i.test(result.body.toString('utf8'))) {
          policy.robots = robotsParser(robotsUrl, result.body.toString('utf8'));
        } else {
          policy.denied = `The site's robots policy could not be safely established (HTTP ${result.status}); automatic retrieval stopped.`;
          policy.expires = Date.now() + 60_000;
        }
        this.robotsCache.set(key, policy);
      } catch (error) {
        aborted(signal);
        throw new Error(`Unable to check robots.txt; automatic retrieval stopped. ${error instanceof Error ? error.message : ''}`);
      }
    }
    if (policy.denied) throw new Error(policy.denied);
    if (policy.robots?.isAllowed(url.href, 'Fieldmark') === false) throw new Error('This path is disallowed by the site’s robots.txt policy.');
    const crawlDelay = policy.robots?.getCrawlDelay('Fieldmark');
    if (crawlDelay != null && Number.isFinite(crawlDelay) && crawlDelay > 0) {
      if (crawlDelay > 60) throw new Error('The site requests a crawl delay over 60 seconds. Open this resource manually.');
      this.hostDelay.set(url.hostname.toLowerCase(), Math.max(600, crawlDelay * 1000));
    }
  }

  private requireSuccess(result: ResponseData): void {
    if (result.status < 200 || result.status >= 300) {
      const restricted = [401, 403, 407, 429].includes(result.status);
      throw new Error(`The public server returned HTTP ${result.status}.${restricted ? ' Access restrictions and rate limits are not bypassed.' : ''}`);
    }
  }

  async inspectPage(url: string, signal?: AbortSignal): Promise<{ url: string; title: string; text: string; links: { url: string; text: string }[]; contentType: string }> {
    const result = await this.fetch(url, 2 * MiB, signal);
    this.requireSuccess(result);
    const contentType = (result.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const source = result.body.toString('utf8');
    const isHtml = /(?:html|xhtml)/i.test(contentType) || /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(source);
    if (!isHtml) {
      if (contentType.startsWith('text/') && !extensionOf(suggestedName(result.url, result.headers))) return { url: result.url, title: new URL(result.url).hostname, text: source.slice(0, 40_000), links: [], contentType };
      const format = classifyAsset(result.body, suggestedName(result.url, result.headers), contentType);
      return { url: result.url, title: safeFilename(suggestedName(result.url, result.headers)), text: `${format.note} This is a binary asset; its document text has not been extracted. Use the asset probe for file verification.`, links: [], contentType };
    }
    const document = parse(source);
    const titleNode = firstTag(document, 'title');
    const body = firstTag(document, 'body') ?? document;
    const title = (titleNode ? htmlText(titleNode) : '').replace(/\s+/g, ' ').trim() || new URL(result.url).hostname;
    const visibleText = htmlText(body, true).replace(/\s+/g, ' ').trim();
    if (/^(?:access denied|attention required|just a moment|sign in|log in|login|captcha)\b/i.test(title) || /(?:verify (?:that )?you are human|checking your browser|enable javascript and cookies to continue|sign in to continue|cf-chl-)/i.test(source.slice(0, 30_000)) || (visibleText.length < 1500 && /(?:access denied|authentication required)/i.test(visibleText))) {
      throw new Error('The page is an access, authentication, or bot-check wall. Automatic retrieval stopped.');
    }
    let base = result.url;
    const baseNode = firstTag(document, 'base');
    const declaredBase = baseNode ? attribute(baseNode, 'href') : undefined;
    if (declaredBase) { try { base = redirectUrl(base, declaredBase).href; } catch { /* Ignore unsafe HTML base URLs. */ } }
    const links = new Map<string, { url: string; text: string }>();
    for (const element of walk(document)) {
      if (links.size >= 240) break;
      if (!isElement(element)) continue;
      const key = ['a', 'link'].includes(element.tagName) ? 'href' : ['iframe', 'embed'].includes(element.tagName) ? 'src' : element.tagName === 'object' ? 'data' : undefined;
      const href = key ? attribute(element, key) : undefined;
      if (!href) continue;
      try {
        const target = redirectUrl(base, href).href;
        const label = (htmlText(element, true) || attribute(element, 'title') || attribute(element, 'aria-label') || new URL(target).pathname.split('/').pop() || target).replace(/\s+/g, ' ').trim().slice(0, 240);
        links.set(target, { url: target, text: label });
      } catch { /* Links are data; invalid/private/credential-bearing links are excluded. */ }
    }
    const content = firstTag(body, 'main') ?? firstTag(body, 'article') ?? body;
    let text = htmlText(content, true).replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > 40_000 || result.truncated) text = `${text.slice(0, 40_000)}\n\n[Page excerpt truncated at the inspection limit.]`;
    return { url: result.url, title, text, links: [...links.values()], contentType: contentType || 'text/html' };
  }

  async probeAsset(url: string, signal?: AbortSignal): Promise<{ url: string; kind: string; bytes: number; mediaType: string; sha256?: string; note: string }> {
    const result = await this.fetch(url, Math.min(this.downloadLimit(), 4 * MiB), signal);
    this.requireSuccess(result);
    const format = classifyAsset(result.body, suggestedName(result.url, result.headers), result.headers['content-type']);
    return {
      url: result.url, kind: format.kind, bytes: result.truncated ? (result.declaredLength ?? result.body.length) : result.body.length,
      mediaType: format.mediaType,
      ...(result.truncated ? {} : { sha256: createHash('sha256').update(result.body).digest('hex') }),
      note: `${format.note}${result.truncated ? ` Only the first ${result.body.length} bytes were inspected; the full file has not been verified or hashed.${result.declaredLength === undefined ? ' Total size is unknown; the reported byte count is a lower bound.' : ' Total size is reported by the server.'}` : ' The complete response was read and SHA-256 hashed.'}`,
    };
  }

  async downloadAsset(url: string, missionId: string, evidenceId: string, signal?: AbortSignal): Promise<Asset> {
    const limit = this.downloadLimit();
    const result = await this.fetch(url, limit, signal);
    this.requireSuccess(result);
    if (result.truncated) throw new Error(`The file exceeds the ${limit / MiB} MB download limit. No file was saved.`);
    if (result.body.length === 0) throw new Error('The server returned an empty file.');
    const name = suggestedName(result.url, result.headers);
    const format = classifyAsset(result.body, name, result.headers['content-type']);
    if (format.kind === 'unknown') throw new Error('The file format could not be verified. Only PDF, DWG, DXF, RFA, RVT, IFC, STEP, IGES, and ZIP files can be saved.');
    const sha256 = createHash('sha256').update(result.body).digest('hex');
    const target = path.join(this.assetDirectory, `${sha256}.${format.kind}`);
    aborted(signal);
    await mkdir(this.assetDirectory, { recursive: true });
    const temporary = path.join(this.assetDirectory, `.${randomUUID()}.part`);
    try {
      const existing = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      let reusable = false;
      if (existing?.isFile() && existing.size === result.body.length) {
        const existingBytes = await readFile(target, { signal }).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        reusable = existingBytes !== null && createHash('sha256').update(existingBytes).digest('hex') === sha256;
      }
      if (!reusable) {
        await writeFile(temporary, result.body, { flag: 'wx' });
        aborted(signal);
        await rename(temporary, target);
      }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return { id: randomUUID(), missionId, evidenceId, name: safeFilename(name, format.kind), path: target, sourceUrl: result.url, sha256, bytes: result.body.length, mediaType: format.mediaType, downloadedAt: new Date().toISOString() };
  }
}
