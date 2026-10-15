import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { Store } from '../electron/store';
import { createDossier } from '../electron/export';
import { missionInputSchema, settingsSchema } from '../electron/validation';
import type { MissionInput } from '../src/shared/types';

const input: MissionInput = { title: 'Manual investigation', manufacturer: 'Test', model: 'T-100', kind: 'manuals', request: 'Find exact manual', region: '', depth: 'thorough', seedUrls: [] };
const testDirectory = join(process.cwd(), 'test-results', 'temporary');
mkdirSync(testDirectory, { recursive: true });
test('a crash preserves findings, tool history and a resumable state', () => {
 const directory = mkdtempSync(join(testDirectory, 'fieldmark-store-'));
 try {
  const store = new Store(directory); const mission = store.createMission(input);
  mission.status = 'running'; mission.answer.text = 'Partial findings'; store.saveMission(mission);
  store.saveHistory(mission.id, [{ role: 'assistant', content: [{ type: 'server_tool_use', id: '123', name: 'web_search', input: { query: 'test' } }] }]);
  const restarted = new Store(directory);
  assert.equal(restarted.getMission(mission.id).status, 'paused');
  assert.equal(restarted.getMission(mission.id).answer.text, 'Partial findings');
  assert.equal(restarted.getHistory(mission.id)[0].content[0].id, '123');
  assert.throws(() => restarted.getHistory('../../outside'), /Invalid/);
 } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('a corrupt database is preserved instead of silently replaced', () => {
 const directory = mkdtempSync(join(testDirectory, 'fieldmark-corrupt-'));
 try { writeFileSync(join(directory, 'workspace.json'), '{broken'); assert.throws(() => new Store(directory)); assert.equal(readFileSync(join(directory, 'workspace.json'), 'utf8'), '{broken'); }
 finally { rmSync(directory, { recursive: true, force: true }); }
});
test('export binds bytes to evidence, omits local paths, and detects tampering', () => {
 const directory = mkdtempSync(join(testDirectory, 'fieldmark-export-'));
 try {
  const store = new Store(directory); const mission = store.createMission(input);
  const assets = join(directory, 'assets'); mkdirSync(assets); const file = join(assets, 'manual.pdf'); const content = Buffer.from('%PDF-1.7\nfixture'); writeFileSync(file, content);
  const asset = { id: 'asset-1', missionId: mission.id, evidenceId: 'evidence-1', name: 'manual.pdf', path: file, sourceUrl: 'https://example.com/manual.pdf', sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length, mediaType: 'application/pdf', downloadedAt: new Date().toISOString() };
  const zip = unzipSync(createDossier(mission, [asset], assets)); const manifest = JSON.parse(strFromU8(zip['manifest.json']));
  assert.equal(manifest.files[0].sourceUrl, asset.sourceUrl); assert.equal(manifest.files[0].path, undefined); assert.deepEqual(Buffer.from(zip[manifest.files[0].archivePath]), content);
  writeFileSync(file, 'modified'); assert.throws(() => createDossier(mission, [asset], assets), /changed/);
 } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('representative lookup requires territory and renderer cannot supply privileged fields', () => {
 assert.equal(missionInputSchema.safeParse({ ...input, kind: 'representative' }).success, false);
 assert.equal(missionInputSchema.safeParse({ ...input, directory: 'C:\\Windows' }).success, false);
 assert.equal(missionInputSchema.safeParse({ ...input, seedUrls: ['file:///etc/passwd'] }).success, false);
 assert.equal(settingsSchema.safeParse({ model: 'claude-sonnet-5-5', maxRequests: 9999, maxSearches: 2, maxDownloadMb: 100 }).success, false);
});
