import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchEngine } from '../electron/research';
import type { ResearchTools } from '../electron/research-tools';
import type { Mission, Settings } from '../src/shared/types';

const call = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const reply = (content: any[], stop_reason = 'tool_use', searches = 0) => ({ type: 'message', content, stop_reason,
  usage: { input_tokens: 100, output_tokens: 30, server_tool_use: { web_search_requests: searches } } });
const finish = (url = 'https://maker.example/manual.pdf') => call('finish', 'finish_investigation', {
  answer: 'The manual covers the requested M-100 model. Applicability is a Claude assessment.', outcome: 'complete',
  citations: [{ url, title: 'M-100 manual' }], unresolved: ['Confirm the installed revision before design use.'],
});
const evidence = (url: string, extra: Record<string, any> = {}) => call('evidence', 'record_evidence', {
  title: 'M-100 manual', url, sourceType: 'manufacturer', kind: 'manual', match: 'exact',
  rationale: 'The model appears in the manual coverage list.', excerpt: 'Models M-100 and M-200', ...extra,
});

function fixture(responses: any[] = [], options: { settings?: Partial<Settings>; tools?: Record<string, any>; request?: any; seeds?: string[]; history?: any[]; depth?: Mission['depth'] } = {}) {
  let mission: Mission = {
    id: 'case-1', title: 'Find M-100 documentation', manufacturer: 'Maker', model: 'M-100', kind: 'manuals',
    request: 'Find the installation and maintenance manual.', region: 'California', depth: options.depth || 'thorough',
    seedUrls: options.seeds || [], status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    strategies: [{ id: 'official', title: 'Manufacturer resources', detail: 'Search official sources.', status: 'pending' }],
    evidence: [], activity: [], answer: { text: '', citations: [] }, unresolved: [],
    usage: { inputTokens: 0, outputTokens: 0, searches: 0, requests: 0 },
  };
  let history = structuredClone(options.history || []);
  const requests: any[] = [];
  const settings: Settings = { model: 'claude-sonnet-5-5', maxRequests: 12, maxSearches: 8, maxDownloadMb: 100, hasApiKey: true, ...options.settings };
  const tools = {
    inspectPage: async (url: string) => ({ url, title: 'M-100 product', text: 'Models M-100 and M-200. Installation manual.',
      links: [{ url: 'https://maker.example/manual.pdf', text: 'Installation manual' }], contentType: 'text/html' }),
    probeAsset: async (url: string) => ({ url, kind: 'pdf', bytes: 2048, mediaType: 'application/pdf', note: 'PDF signature observed.' }),
    ...options.tools,
  } as unknown as ResearchTools;
  const deps: ConstructorParameters<typeof ResearchEngine>[0] = {
    getMission: () => structuredClone(mission), saveMission: m => { mission = structuredClone(m); },
    getSettings: () => settings, getApiKey: async () => 'sk-ant-test-secret', tools,
    getHistory: () => structuredClone(history), saveHistory: (_, messages) => { history = structuredClone(messages); },
  };
  if (options.request !== null) deps.request = options.request || (async (body: any) => {
    requests.push(structuredClone(body));
    if (!responses.length) throw new Error('Unexpected extra request.');
    return responses.shift();
  });
  const engine = new ResearchEngine(deps);
  return { engine, mission: () => mission, history: () => history, requests, responses, settings };
}

test('search provenance, file probe and applicability assessment produce a persistent cited report', async () => {
  const source = { type: 'web_search_result', url: 'https://maker.example/manual.pdf', title: 'M-100 manual', encrypted_content: 'opaque-content' };
  const f = fixture([
    reply([{ type: 'server_tool_use', id: 'search', name: 'web_search', input: { query: 'Maker M-100 manual' } },
      { type: 'web_search_tool_result', tool_use_id: 'search', content: [source] },
      call('probe', 'probe_asset', { url: source.url }), evidence(source.url)] , 'tool_use', 1),
    reply([finish()]),
  ]);
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'complete');
  assert.equal(f.mission().evidence.length, 1);
  assert.equal(f.mission().evidence[0].match, 'unverified', 'format probe alone cannot substantiate an exact model match');
  assert.equal(f.mission().evidence[0].excerpt, '', 'an unchecked model-created quotation must not be displayed as source text');
  assert.match(f.mission().evidence[0].rationale, /Claude assessment; not independently verified/);
  assert.ok(f.mission().evidence[0].fetchedAt);
  assert.equal(f.mission().usage.searches, 1);
  assert.equal(f.mission().usage.requests, 2);
  assert.equal(f.mission().usage.inputTokens, 200);
  assert.equal(f.mission().answer.citations[0].url, source.url);
  assert.equal(f.requests[1].messages[1].content[1].content[0].encrypted_content, 'opaque-content');
  assert.equal(f.requests[1].messages[1].stop_reason, undefined, 'local checkpoint metadata must not leak into API messages');
  assert.equal(f.engine.isRunning('case-1'), false);
});

test('invented evidence URLs and invented final citations are rejected', async () => {
  const f = fixture([
    reply([evidence('https://invented.example/file.pdf'), finish('https://invented.example/file.pdf')]),
    reply([call('blocked', 'finish_investigation', { answer: 'No source has established the requested document.', outcome: 'blocked', citations: [], unresolved: ['Find a public source.'] })]),
  ]);
  await f.engine.run('case-1');
  assert.equal(f.mission().evidence.length, 0);
  assert.equal(f.mission().status, 'blocked');
  const rejected = f.history()[2].content;
  assert.ok(rejected.every((result: any) => result.is_error));
  assert.match(rejected[0].content, /has not appeared/);
});

test('exact matches require an excerpt and observed page text rejects fabricated excerpts', async () => {
  const url = 'https://maker.example/product';
  const f = fixture([
    reply([call('inspect', 'inspect_page', { url }), evidence(url, { excerpt: '' }),
      { ...evidence(url, { excerpt: 'M-100 includes BACnet as standard.' }), id: 'invented-quote' }]),
    reply([evidence(url), finish(url)]),
  ]);
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'complete');
  assert.equal(f.mission().evidence.length, 1);
  assert.match(f.history()[2].content[1].content, /requires a verbatim/);
  assert.match(f.history()[2].content[2].content, /does not occur/);
});

test('inspected links become valid provenance without falsely marking linked files as fetched', async () => {
  const f = fixture([
    reply([call('inspect', 'inspect_page', { url: 'https://maker.example/product' }), evidence('https://maker.example/manual.pdf')]),
    reply([finish()]),
  ]);
  await f.engine.run('case-1');
  assert.equal(f.mission().evidence.length, 1);
  assert.equal(f.mission().evidence[0].fetchedAt, undefined);
  assert.equal(f.mission().evidence[0].match, 'unverified');
  assert.match(f.mission().evidence[0].rationale, /source text was not inspected/);
});

test('case seed alone cannot substantiate exact applicability or a source quotation', async () => {
  const f = fixture([reply([evidence('https://maker.example/manual.pdf'), finish()])], { seeds: ['https://maker.example/manual.pdf'] });
  await f.engine.run('case-1');
  assert.equal(f.mission().evidence[0].match, 'unverified');
  assert.equal(f.mission().evidence[0].excerpt, '');
  assert.match(f.history()[2].content[0].content, /Exact match downgraded/);
});

test('native web-fetch document text has source provenance and validates excerpts', async () => {
  const url = 'https://maker.example/manual.pdf';
  const f = fixture([
    reply([{ type: 'web_fetch_tool_result', tool_use_id: 'fetch', content: { type: 'web_fetch_result', url,
      retrieved_at: '2026-10-15T12:00:00Z', content: { type: 'document', title: 'M-100 manual',
        source: { type: 'text', media_type: 'text/plain', data: 'Models M-100 and M-200' } } } }, evidence(url), finish(url)]),
  ]);
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'complete');
  assert.equal(f.mission().evidence[0].fetchedAt, '2026-10-15T12:00:00Z');
});

test('pause_turn preserves native server blocks and identical tools', async () => {
  const native = { type: 'server_tool_use', id: 'native-1', name: 'web_search', input: { query: 'M-100' } };
  const f = fixture([
    reply([native], 'pause_turn', 1),
    reply([finish()], 'tool_use'),
  ], { seeds: ['https://maker.example/manual.pdf'] });
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'complete');
  assert.deepEqual(f.requests[0].tools, f.requests[1].tools);
  assert.deepEqual(f.requests[1].messages.at(-1).content, [native]);
  assert.equal(f.requests[0].tools.find((item: any) => item.name === 'web_search').max_uses, 1);
});

test('whole-run search and request limits stop continuations and preserve checkpoints', async () => {
  const f = fixture([
    reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'one' } }], 'pause_turn', 1),
    reply([{ type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: 'two' } }], 'pause_turn', 1),
    reply([finish()]),
  ], { settings: { maxSearches: 2 }, seeds: ['https://maker.example/manual.pdf'] });
  await f.engine.run('case-1');
  assert.equal(f.requests.length, 3);
  assert.equal(f.mission().usage.searches, 2);
  assert.equal(f.mission().status, 'paused');
  assert.match(f.mission().stopReason!, /Search budget reached/);
  assert.ok(f.mission().answer.text);
  assert.equal(f.requests[2].tools.some((tool: any) => ['web_search', 'web_fetch'].includes(tool.name)), false);
  assert.equal(f.requests[2].messages.length, 1, 'terminal synthesis has its own context, without pending server history');
  assert.ok(f.history().some(message => message.phase?.startsWith('synthesis:')));
  const requestBound = fixture([reply([], 'pause_turn'), reply([], 'pause_turn')], { settings: { maxRequests: 2 } });
  await requestBound.engine.run('case-1');
  assert.equal(requestBound.requests.length, 2);
  assert.match(requestBound.mission().stopReason!, /Request budget reached/);
  assert.match(requestBound.mission().answer.text, /Research checkpoint/);
});

test('the last permitted search can inspect its observed lead and finalize without another native search', async () => {
  const url = 'https://maker.example/product';
  const native = { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url, title: 'M-100 product', encrypted_content: 'preserve-me' }] };
  const f = fixture([
    reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'M-100' } }, native], 'pause_turn', 1),
    reply([call('inspect-final', 'inspect_page', { url })]),
    reply([evidence(url), finish(url)]),
    reply([finish(url)]),
  ], { settings: { maxSearches: 1 } });
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'paused');
  assert.equal(f.mission().usage.searches, 1);
  assert.equal(f.mission().evidence[0].match, 'exact');
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.slice(1).every(body => body.tools.every((tool: any) => !['web_search', 'web_fetch'].includes(tool.name))));
  assert.ok(f.requests[1].messages[0].content.includes(url));
  assert.equal(f.requests[1].messages[0].phase, undefined);
  assert.equal(f.requests[1].messages[0].phase_reason, undefined);
  assert.deepEqual(f.history()[1].content[1], native, 'pending native conversation remains intact');
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'complete');
  assert.equal(f.requests[3].tools.some((tool: any) => tool.name === 'web_search'), true);
  assert.equal(f.requests[3].messages.at(-1).role, 'assistant');
  assert.deepEqual(f.requests[3].messages.at(-1).content[1], native);
});

test('unchecked quotations are stripped for all applicability categories and final citations', async () => {
  const url = 'https://maker.example/manual.pdf';
  const final = finish(url);
  final.input.citations[0].excerpt = 'A completely fabricated quotation.';
  const f = fixture([reply([
    ...['family', 'alternative', 'unverified'].map((match, index) => ({ ...evidence(url, { match, kind: `resource-${index}`, excerpt: 'A completely fabricated quotation.' }), id: `e${index}` })), final,
  ])], { seeds: [url] });
  await f.engine.run('case-1');
  assert.equal(f.mission().evidence.length, 3);
  assert.ok(f.mission().evidence.every(item => item.excerpt === ''));
  assert.ok(f.mission().evidence.every(item => item.rationale.includes('Unchecked source quotation removed')));
  assert.equal(f.mission().answer.citations[0].excerpt, undefined);
});

test('canceling a finishing-phase inspection resumes its checkpoint without enabling search', async () => {
  const url = 'https://maker.example/product';
  let inspected = 0;
  let notifyStarted!: () => void;
  const started = new Promise<void>(resolve => { notifyStarted = resolve; });
  const f = fixture([
    reply([{ type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url, title: 'Product' }] }], 'pause_turn', 1),
    reply([call('final-inspect', 'inspect_page', { url })]),
    reply([evidence(url), finish(url)]),
  ], { settings: { maxSearches: 1 }, tools: { inspectPage: async (requestedUrl: string, signal: AbortSignal) => {
    inspected++;
    if (inspected === 1) {
      notifyStarted();
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true }));
    }
    return { url: requestedUrl, title: 'Product', text: 'Models M-100 and M-200', links: [], contentType: 'text/html' };
  } } });
  const first = f.engine.run('case-1');
  await started;
  f.engine.pause('case-1');
  await first;
  assert.match(f.mission().stopReason!, /Paused by user/);
  await f.engine.run('case-1');
  assert.equal(inspected, 2);
  assert.equal(f.mission().status, 'paused');
  assert.match(f.mission().stopReason!, /Search budget reached/);
  assert.equal(f.mission().evidence[0].match, 'exact');
  assert.ok(f.requests.slice(1).every(body => body.tools.every((tool: any) => !['web_search', 'web_fetch'].includes(tool.name))));
  assert.ok(f.mission().answer.text);
});

test('one failing client call per turn stops after five consecutive actual failures', async () => {
  let inspected = 0;
  const f = fixture([
    ...Array.from({ length: 5 }, (_, i) => reply([call(`bad-${i}`, 'inspect_page', { url: 'https://maker.example/blocked' })])),
    reply([call('finish-failures', 'finish_investigation', { answer: 'The observed page could not be accessed.', outcome: 'blocked', citations: [], unresolved: ['Access restrictions prevented source inspection.'] })]),
  ], { tools: { inspectPage: async () => { inspected++; throw new Error('Publisher disallows automated access.'); } } });
  await f.engine.run('case-1');
  assert.equal(inspected, 5);
  assert.equal(f.requests.length, 6);
  assert.equal(f.mission().status, 'paused');
  assert.match(f.mission().stopReason!, /five consecutive tool failures/);
  assert.match(f.mission().answer.text, /could not be accessed/);
  assert.equal(f.requests[5].tools.some((tool: any) => tool.name === 'web_search'), false);
});

test('a one-request budget still returns a useful checkpoint when its search pauses', async () => {
  const url = 'https://maker.example/manual.pdf';
  const f = fixture([reply([{ type: 'web_search_tool_result', tool_use_id: 's', content: [{ type: 'web_search_result', url, title: 'Manual' }] }], 'pause_turn', 1)],
    { settings: { maxRequests: 1, maxSearches: 1 } });
  await f.engine.run('case-1');
  assert.equal(f.requests.length, 1);
  assert.equal(f.mission().status, 'paused');
  assert.match(f.mission().answer.text, /No applicable resource has been established/);
  assert.equal(f.mission().answer.citations[0].url, url);
});

test('depth sets practical caps inside global settings and exhaustive supports the full settings range', async () => {
  const focused = fixture([reply([finish()])], { depth: 'focused', seeds: ['https://maker.example/manual.pdf'], settings: { maxRequests: 80, maxSearches: 150 } });
  await focused.engine.run('case-1');
  assert.deepEqual(JSON.parse(focused.requests[0].messages[0].content).limits, { requests: 8, searches: 4 });
  const exhaustive = fixture([reply([finish()])], { depth: 'exhaustive', seeds: ['https://maker.example/manual.pdf'], settings: { maxRequests: 80, maxSearches: 150 } });
  await exhaustive.engine.run('case-1');
  assert.deepEqual(JSON.parse(exhaustive.requests[0].messages[0].content).limits, { requests: 80, searches: 150 });
  assert.equal(exhaustive.requests[0].output_config.effort, 'high');
});

test('cancel during a tool persists completed work and resumes only the missing tool result', async () => {
  let inspected = 0;
  let releaseStarted!: () => void;
  const started = new Promise<void>(resolve => { releaseStarted = resolve; });
  const f = fixture([
    reply([call('strategy', 'update_strategy', { id: 'official', title: 'Manufacturer resources', detail: 'Found product page.', status: 'active' }),
      call('inspect', 'inspect_page', { url: 'https://maker.example/product' })]),
    reply([evidence('https://maker.example/manual.pdf'), finish()]),
  ], { tools: { inspectPage: async (url: string, signal: AbortSignal) => {
    inspected++;
    if (inspected === 1) {
      releaseStarted();
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true }));
    }
    return { url, title: 'Product', text: 'Models M-100 and M-200', links: [{ url: 'https://maker.example/manual.pdf', text: 'Manual' }], contentType: 'text/html' };
  } } });
  const first = f.engine.run('case-1');
  await started;
  assert.equal(f.engine.isRunning('case-1'), true);
  f.engine.pause('case-1');
  await first;
  assert.equal(f.mission().status, 'paused');
  assert.equal(f.history()[2].content.length, 1);
  assert.equal(f.history()[2].content[0].tool_use_id, 'strategy');
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'complete');
  assert.equal(inspected, 2);
  assert.equal(f.history()[2].content.length, 2);
  assert.equal(f.mission().activity.filter(item => item.message === 'Manufacturer resources — active').length, 1);
});

test('HTTP 200 native-tool failures are visible and never become missing-file proof', async () => {
  const f = fixture([reply([{ type: 'web_search_tool_result', tool_use_id: 's',
    content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }], 'end_turn', 1)]);
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'paused');
  assert.ok(f.mission().activity.some(item => /max_uses_exceeded/.test(item.message) && /not evidence/.test(item.message)));
  assert.match(f.mission().stopReason!, /source-tool error/);
});

test('resuming an interrupted final text creates a user continuation instead of an invalid assistant prefill', async () => {
  const f = fixture([reply([{ type: 'text', text: 'Partial report.' }], 'max_tokens'), reply([finish()])],
    { seeds: ['https://maker.example/manual.pdf'] });
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'paused');
  await f.engine.run('case-1');
  assert.equal(f.mission().status, 'complete');
  assert.equal(f.requests[1].messages.at(-1).role, 'user');
  assert.match(f.requests[1].messages.at(-1).content, /Continue the saved investigation/);
});

test('credentials and upstream error bodies are never exposed in authentication diagnostics', async () => {
  const previousFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response('secret sk-ant-test-secret and private account details', { status: 401 }); };
  try {
    const f = fixture([], { request: null });
    await f.engine.run('case-1');
    assert.equal(attempts, 1);
    assert.equal(f.mission().status, 'blocked');
    assert.match(f.mission().stopReason!, /Update it in Settings/);
    assert.doesNotMatch(JSON.stringify(f.mission()), /sk-ant-test-secret|private account details/);
  } finally { globalThis.fetch = previousFetch; }
});

test('transient API failures retry no more than twice and count each attempt', async () => {
  const previousFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response('{}', { status: 429, headers: { 'retry-after': '0.001' } }); };
  try {
    const f = fixture([], { request: null });
    await f.engine.run('case-1');
    assert.equal(attempts, 3);
    assert.equal(f.mission().usage.requests, 3);
    assert.equal(f.mission().status, 'blocked');
    assert.match(f.mission().stopReason!, /usage and billing/);
  } finally { globalThis.fetch = previousFetch; }
});
