import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Asset, Mission, MissionInput, Settings, Snapshot, Strategy } from '../src/shared/types';

export const DEFAULT_SETTINGS: Settings = { model: 'claude-sonnet-5-5', maxRequests: 18, maxSearches: 32, maxDownloadMb: 100, hasApiKey: false };
interface Database { version: 1; missions: Mission[]; assets: Asset[]; settings: Settings; }
export function atomicWrite(path: string, data: string | Buffer) {
 const temp = `${path}.${randomUUID()}.tmp`;
 try { writeFileSync(temp, data, { mode: 0o600 }); renameSync(temp, path); }
 catch (error) { if (existsSync(temp)) unlinkSync(temp); throw error; }
}
export function createStrategies(): Strategy[] {
 return [
  { id: 'identity', title: 'Establish equipment identity', detail: 'Exact model, variants, generation, and territory.', status: 'pending' },
  { id: 'official', title: 'Search manufacturer sources', detail: 'Product pages, document libraries, and regional sites.', status: 'pending' },
  { id: 'expanded', title: 'Follow the harder leads', detail: 'Legacy names, distributors, BIM libraries, and public archives.', status: 'pending' },
  { id: 'verify', title: 'Check applicability and files', detail: 'Model coverage, revisions, source evidence, and file signatures.', status: 'pending' },
  { id: 'synthesize', title: 'Build the evidence brief', detail: 'Supported findings, uncertainties, and useful next steps.', status: 'pending' }
 ];
}
export function newMission(input: MissionInput): Mission {
 const at = new Date().toISOString();
 return { ...input, id: randomUUID(), createdAt: at, updatedAt: at, status: 'draft', strategies: createStrategies(), evidence: [], activity: [], answer: { text: '', citations: [] }, unresolved: [], usage: { inputTokens: 0, outputTokens: 0, searches: 0, requests: 0 } };
}
export class Store {
 private db: Database;
 private file: string;
 private historyDirectory: string;
 onChange: (() => void) | undefined;
 constructor(public directory: string) {
  mkdirSync(directory, { recursive: true });
  this.historyDirectory = join(directory, 'history'); mkdirSync(this.historyDirectory, { recursive: true });
  this.file = join(directory, 'workspace.json');
  if (existsSync(this.file)) {
   const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
   if (parsed.version !== 1 || !Array.isArray(parsed.missions) || !Array.isArray(parsed.assets)) throw new Error('The saved workspace is not a supported Fieldmark database. It has been preserved.');
   this.db = parsed;
   this.db.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
   for (const mission of this.db.missions) if (mission.status === 'running') { mission.status = 'paused'; mission.stopReason = 'The app closed during research. Resume to continue from the saved checkpoint.'; }
   this.persist();
  } else { this.db = { version: 1, missions: [], assets: [], settings: { ...DEFAULT_SETTINGS } }; this.persist(); }
 }
 private persist() { atomicWrite(this.file, JSON.stringify(this.db, null, 2)); this.onChange?.(); }
 snapshot(): Snapshot { return structuredClone({ missions: this.db.missions, assets: this.db.assets, settings: this.db.settings }); }
 getMission(id: string): Mission { const mission = this.db.missions.find(m => m.id === id); if (!mission) throw new Error('Investigation not found.'); return structuredClone(mission); }
 saveMission(mission: Mission) { const idx = this.db.missions.findIndex(m => m.id === mission.id); mission.updatedAt = new Date().toISOString(); if (idx >= 0) this.db.missions[idx] = structuredClone(mission); else this.db.missions.unshift(structuredClone(mission)); this.persist(); }
 createMission(input: MissionInput) { const mission = newMission(input); this.saveMission(mission); return mission; }
 deleteMission(id: string) { this.getMission(id); this.db.missions = this.db.missions.filter(m => m.id !== id); const file = this.historyPath(id); if (existsSync(file)) unlinkSync(file); this.persist(); }
 getSettings(): Settings { return { ...this.db.settings }; }
 saveSettings(settings: Settings) { this.db.settings = { ...settings }; this.persist(); return this.getSettings(); }
 addAsset(asset: Asset) {
  const previous = this.db.assets.find(a => a.missionId === asset.missionId && a.evidenceId === asset.evidenceId && a.sha256 === asset.sha256);
  const result = previous ?? asset; if (!previous) this.db.assets.unshift(asset);
  const evidence = this.db.missions.find(m => m.id === asset.missionId)?.evidence.find(e => e.id === asset.evidenceId);
  if (evidence) { evidence.assetId = result.id; evidence.fetchedAt = result.downloadedAt; }
  this.persist(); return structuredClone(result);
 }
 getAsset(id: string): Asset { const asset = this.db.assets.find(a => a.id === id); if (!asset) throw new Error('Saved file not found.'); return structuredClone(asset); }
 private historyPath(id: string) { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid investigation identifier.'); return join(this.historyDirectory, `${id}.json`); }
 getHistory(id: string): any[] { const file = this.historyPath(id); return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []; }
 saveHistory(id: string, messages: any[]) { atomicWrite(this.historyPath(id), JSON.stringify(messages)); }
}
