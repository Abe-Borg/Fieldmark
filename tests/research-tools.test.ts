import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import type { ClientRequest, IncomingMessage, RequestOptions, IncomingHttpHeaders } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ResearchTools, assertPublicAddress, parsePublicUrl, redirectUrl, classifyAsset, safeFilename } from '../electron/research-tools';

type Result = { url: string; status: number; headers: IncomingHttpHeaders; body: Buffer; truncated: boolean; declaredLength?: number };
type Internals = {
  request(url: URL, maxBytes: number, signal?: AbortSignal): Promise<Result>;
  fetch(url: string, maxBytes: number, signal?: AbortSignal, checkRobots?: boolean): Promise<Result>;
};
const asInternal = (tools: ResearchTools): Internals => tools as unknown as Internals;
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const testRoot = path.resolve('test-results', 'temporary');

function fixtureTools(responses: Record<string, Partial<Result>>, directory = path.join(testRoot, 'fieldmark-unused')) {
  const tools = new ResearchTools({ assetDirectory: directory, maxDownloadMb: () => 1 });
  const requested: string[] = [];
  asInternal(tools).request = async (url, maxBytes, signal) => {
    signal?.throwIfAborted();
    requested.push(url.href);
    const response = responses[url.href] ?? (url.pathname === '/robots.txt' ? { status: 404 } : undefined);
    if (!response) throw new Error(`Unexpected fixture URL: ${url.href}`);
    const body = response.body ?? Buffer.alloc(0);
    return { url: url.href, status: 200, headers: {}, truncated: false, ...response, body: body.subarray(0, maxBytes), ...(body.length > maxBytes ? { truncated: true } : {}) };
  };
  return { tools, requested };
}

test('blocks private, special, and disguised loopback URL representations', () => {
  const invalid = [
    'http://127.0.0.1/x', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://10.0.0.1/', 'http://172.16.2.3/', 'http://192.168.1.1/', 'http://169.254.169.254/',
    'http://0.0.0.0/', 'http://100.64.0.1/', 'http://224.0.0.1/', 'http://198.18.0.1/', 'http://192.0.2.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a00:1]/', 'http://[::127.0.0.1]/',
    'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[fec0::1]/', 'http://[2001:db8::1]/', 'http://[4000::1]/',
    'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://localhost./', 'http://printer.local/',
    'http://metadata.google.internal/', 'http://machine.home.arpa/', 'https://example.com:8080/',
    'file:///C:/Windows/system.ini', 'ftp://example.com/manual.pdf', 'https://alice:secret@example.com/manual.pdf',
  ];
  for (const url of invalid) assert.throws(() => parsePublicUrl(url), /./, url);
  for (const address of ['127.0.0.1', '::ffff:127.0.0.1', '::', '255.255.255.255', '203.0.113.1']) assert.throws(() => assertPublicAddress(address));
  assert.equal(parsePublicUrl('https://example.com/manual.pdf#page=9').href, 'https://example.com/manual.pdf');
  assert.doesNotThrow(() => assertPublicAddress('8.8.8.8'));
  assert.doesNotThrow(() => assertPublicAddress('2606:4700:4700::1111'));
});

test('redirects retain normal relative locations but reject credentials and private destinations', async () => {
  assert.equal(redirectUrl('https://example.com/a/b', '../manual.pdf').href, 'https://example.com/manual.pdf');
  assert.throws(() => redirectUrl('https://example.com/', '//user:pass@files.example.com/file.pdf'), /credentials/);
  assert.throws(() => redirectUrl('https://example.com/', 'http://127.0.0.1/admin'));
  const { tools, requested } = fixtureTools({ 'https://example.com/file.pdf': { status: 302, headers: { location: 'https://user:pass@files.example.com/file.pdf' } } });
  await assert.rejects(tools.probeAsset('https://example.com/file.pdf'), /credentials/);
  assert.deepEqual(requested, ['https://example.com/robots.txt', 'https://example.com/file.pdf']);
});

test('revalidates robots rules at redirected hosts and never fetches a forbidden target', async () => {
  const { tools, requested } = fixtureTools({
    'https://example.com/file.pdf': { status: 302, headers: { location: 'https://files.example.com/private/file.pdf' } },
    'https://files.example.com/robots.txt': { body: Buffer.from('User-agent: *\nDisallow: /private/\n') },
  });
  await assert.rejects(tools.probeAsset('https://example.com/file.pdf'), /disallowed/);
  assert.equal(requested.includes('https://files.example.com/private/file.pdf'), false);
});

test('robots failure, authentication responses, and bot walls stop automatic retrieval', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const { tools, requested } = fixtureTools({ 'https://example.com/robots.txt': { status } });
    await assert.rejects(tools.inspectPage('https://example.com/product'), /robots policy/);
    assert.deepEqual(requested, ['https://example.com/robots.txt']);
  }
  const authenticated = fixtureTools({ 'https://example.com/file.pdf': { status: 403 } });
  await assert.rejects(authenticated.tools.downloadAsset('https://example.com/file.pdf', 'm', 'e'), /restrictions/);
  const wall = fixtureTools({ 'https://example.com/product': { headers: { 'content-type': 'text/html' }, body: Buffer.from('<html><title>Just a moment</title><body>Verify you are human</body></html>') } });
  await assert.rejects(wall.tools.inspectPage('https://example.com/product'), /bot-check wall/);
});

test('DNS answers must all be public, connections pin the validated IP, and HTTP streams stop at their byte cap', async t => {
  let lookups = 0;
  let responseBody = Buffer.from('public response');
  const dnsMock = t.mock.method(dns, 'lookup', (async () => { lookups++; return [{ address: '93.184.216.34', family: 4 }]; }) as unknown as typeof dns.lookup);
  let connected = 0;
  t.mock.method(https, 'request', ((url: URL, options: RequestOptions, listener: (response: IncomingMessage) => void) => {
    connected++;
    assert.equal(url.hostname, 'public.example.com');
    assert.equal(options.agent, false);
    assert.equal(options.family, 4);
    const headers = options.headers as Record<string, string>;
    assert.match(headers['User-Agent'], /^Fieldmark\//);
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers.Cookie, undefined);
    const lookup = options.lookup as (hostname: string, options: { all: boolean }, callback: (error: Error | null, address: string, family: number) => void) => void;
    lookup('public.example.com', { all: false }, (error, address, family) => {
      assert.equal(error, null); assert.equal(address, '93.184.216.34'); assert.equal(family, 4);
    });
    const req = new EventEmitter() as ClientRequest;
    req.end = (() => {
      queueMicrotask(() => {
        const res = new PassThrough() as unknown as IncomingMessage;
        res.statusCode = 200; res.headers = { 'content-type': 'text/plain' };
        listener(res);
        (res as unknown as PassThrough).end(responseBody);
      });
      return req;
    }) as ClientRequest['end'];
    return req;
  }) as typeof https.request);
  const tools = new ResearchTools({ assetDirectory: testRoot, maxDownloadMb: () => 1 });
  const result = await asInternal(tools).request(parsePublicUrl('https://public.example.com/a'), 1024);
  assert.equal(result.body.toString(), 'public response');
  assert.equal(lookups, 1);
  assert.equal(connected, 1);
  responseBody = Buffer.alloc(16_384, 'a');
  const boundedTools = new ResearchTools({ assetDirectory: testRoot, maxDownloadMb: () => 1 });
  const boundedResult = await asInternal(boundedTools).request(parsePublicUrl('https://public.example.com/large'), 128);
  assert.equal(boundedResult.truncated, true);
  assert.equal(boundedResult.body.length, 128);
  assert.equal(lookups, 2);
  dnsMock.mock.mockImplementation((async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]) as unknown as typeof dns.lookup);
  const otherTools = new ResearchTools({ assetDirectory: testRoot, maxDownloadMb: () => 1 });
  await assert.rejects(asInternal(otherTools).request(parsePublicUrl('https://public.example.com/b'), 1024), /reserved network/);
  assert.equal(connected, 2);
});

test('file validation rejects disguised HTML, scripts, executables, and mismatched extensions', () => {
  assert.throws(() => classifyAsset(Buffer.from('<!DOCTYPE html><html>Login</html>'), 'manual.pdf', 'application/pdf'), /HTML/);
  assert.throws(() => classifyAsset(Buffer.from('MZmalicious'), 'manual.pdf', 'application/pdf'), /Executable/);
  assert.throws(() => classifyAsset(Buffer.from('#!/bin/sh\necho nope'), 'drawing.dxf'), /Executable/);
  assert.throws(() => classifyAsset(pdf, 'manual.exe'), /Executable/);
  assert.throws(() => classifyAsset(pdf, 'model.rfa'), /does not match/);
  assert.equal(classifyAsset(pdf, 'manual.pdf').kind, 'pdf');
  assert.equal(classifyAsset(Buffer.from('AC1032drawing'), 'drawing.dwg').kind, 'dwg');
  assert.equal(classifyAsset(Buffer.from('0\r\nSECTION\r\n2\r\nHEADER\r\n'), 'drawing.dxf').kind, 'dxf');
  assert.equal(classifyAsset(Buffer.from("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));"), 'model.ifc').kind, 'ifc');
  assert.equal(classifyAsset(Buffer.from('PK\x03\x04archive'), 'models.zip').kind, 'zip');
  const revit = classifyAsset(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'family.rfa');
  assert.equal(revit.kind, 'rfa');
  assert.match(revit.note, /version, product match, and compatibility are unverified/);
  assert.equal(classifyAsset(Buffer.from('not a file'), 'manual.pdf').kind, 'unknown');
});

test('page inspection extracts relative asset links, excludes unsafe links, and reports the final URL', async () => {
  const { tools } = fixtureTools({
    'https://example.com/start': { status: 301, headers: { location: '/products/pump/' } },
    'https://example.com/products/pump/': { headers: { 'content-type': 'text/html; charset=UTF-8' }, body: Buffer.from('<html><head><title>Pump A</title></head><body><nav>Navigation noise</nav><main><h1>Pump A</h1><p>Supports chilled water.</p><a href="manual.pdf">Manual</a><a href="http://127.0.0.1/secret">Private</a><a href="https://name:secret@example.com/file.pdf">Login</a><script>doSomething()</script></main></body></html>') },
  });
  const page = await tools.inspectPage('https://example.com/start');
  assert.equal(page.url, 'https://example.com/products/pump/');
  assert.equal(page.title, 'Pump A');
  assert.match(page.text, /Supports chilled water/);
  assert.doesNotMatch(page.text, /Navigation noise|doSomething/);
  assert.deepEqual(page.links, [{ url: 'https://example.com/products/pump/manual.pdf', text: 'Manual' }]);
});

test('downloads are hashed, content-addressed, deduplicated, and cannot traverse paths', async t => {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, 'fieldmark-research-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), testRoot);
    assert.match(path.basename(directory), /^fieldmark-research-test-/);
    await rm(directory, { recursive: true, force: true });
  });
  const { tools } = fixtureTools({
    'https://example.com/get': { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="../../..\\outside.pdf"' }, body: pdf },
    'https://example.com/html.pdf': { headers: { 'content-type': 'application/pdf' }, body: Buffer.from('<html>Sign in</html>') },
  }, directory);
  const asset = await tools.downloadAsset('https://example.com/get', '../mission', '../../evidence');
  const again = await tools.downloadAsset('https://example.com/get', 'another-mission', 'another-evidence');
  const expectedHash = createHash('sha256').update(pdf).digest('hex');
  assert.equal(asset.sha256, expectedHash);
  assert.equal(path.dirname(asset.path), path.resolve(directory));
  assert.equal(path.basename(asset.path), `${expectedHash}.pdf`);
  assert.equal(asset.path, again.path);
  assert.notEqual(asset.id, again.id);
  assert.doesNotMatch(asset.name, /[/\\]/);
  assert.deepEqual(await readFile(asset.path), pdf);
  assert.equal((await readdir(directory)).length, 1);
  await writeFile(asset.path, Buffer.alloc(pdf.length, 'x'));
  const repaired = await tools.downloadAsset('https://example.com/get', 'repair-mission', 'repair-evidence');
  assert.equal(repaired.path, asset.path);
  assert.deepEqual(await readFile(repaired.path), pdf, 'a same-size corrupted cached file must be repaired');
  await assert.rejects(tools.downloadAsset('https://example.com/html.pdf', 'm', 'e'), /HTML/);
  assert.equal((await readdir(directory)).length, 1);
  assert.equal(safeFilename('CON.pdf'), '_CON.pdf');
  assert.doesNotMatch(safeFilename('..\\..\\evil\u0000.pdf', 'pdf'), /[/\\\x00]/);
});

test('oversized probes disclose partial validation and oversized downloads save nothing', async t => {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, 'fieldmark-research-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), testRoot);
    assert.match(path.basename(directory), /^fieldmark-research-test-/);
    await rm(directory, { recursive: true, force: true });
  });
  const largePdf = Buffer.concat([pdf, Buffer.alloc(1024 * 1024)]);
  const { tools } = fixtureTools({ 'https://example.com/large.pdf': { body: largePdf, declaredLength: largePdf.length } }, directory);
  const probe = await tools.probeAsset('https://example.com/large.pdf');
  assert.equal(probe.kind, 'pdf');
  assert.equal(probe.bytes, largePdf.length);
  assert.equal(probe.sha256, undefined);
  assert.match(probe.note, /full file has not been verified or hashed/);
  await assert.rejects(tools.downloadAsset('https://example.com/large.pdf', 'm', 'e'), /exceeds the 1 MB/);
  assert.deepEqual(await readdir(directory), []);
  const aborted = new AbortController(); aborted.abort(new Error('User canceled'));
  await assert.rejects(tools.downloadAsset('https://example.com/large.pdf', 'm', 'e', aborted.signal), /User canceled/);
});
