export type MissionKind = 'manuals' | 'revit' | 'cad' | 'representative' | 'capability' | 'everything';
export type Depth = 'focused' | 'thorough' | 'exhaustive';
export type MissionStatus = 'draft' | 'running' | 'paused' | 'complete' | 'blocked' | 'failed';
export type Match = 'exact' | 'family' | 'alternative' | 'unverified';
export interface MissionInput { title: string; manufacturer: string; model: string; kind: MissionKind; request: string; region: string; depth: Depth; seedUrls: string[]; }
export interface Strategy { id: string; title: string; detail: string; status: 'pending' | 'active' | 'done' | 'blocked'; }
export interface Evidence { id: string; title: string; url: string; sourceType: 'manufacturer' | 'distributor' | 'bim-library' | 'archive' | 'other'; kind: string; match: Match; rationale: string; excerpt: string; page?: string; model?: string; revision?: string; region?: string; discoveredAt: string; fetchedAt?: string; assetId?: string; }
export interface Asset { id: string; missionId: string; evidenceId: string; name: string; path: string; sourceUrl: string; sha256: string; bytes: number; mediaType: string; downloadedAt: string; }
export interface Activity { id: string; at: string; type: 'info' | 'search' | 'fetch' | 'finding' | 'warning' | 'error'; message: string; url?: string; }
export interface Citation { url: string; title: string; excerpt?: string; }
export interface Answer { text: string; citations: Citation[]; }
export interface Usage { inputTokens: number; outputTokens: number; searches: number; requests: number; }
export interface Mission extends MissionInput { id: string; status: MissionStatus; createdAt: string; updatedAt: string; strategies: Strategy[]; evidence: Evidence[]; activity: Activity[]; answer: Answer; usage: Usage; unresolved: string[]; stopReason?: string; demo?: boolean; }
export interface Settings { model: string; maxRequests: number; maxSearches: number; maxDownloadMb: number; hasApiKey: boolean; }
export interface Snapshot { missions: Mission[]; assets: Asset[]; settings: Settings; }
export interface SettingsInput { model: string; maxRequests: number; maxSearches: number; maxDownloadMb: number; apiKey?: string; clearApiKey?: boolean; }
export interface FieldmarkAPI {
 getSnapshot(): Promise<Snapshot>;
 createMission(input: MissionInput): Promise<Mission>;
 runMission(id: string): Promise<void>;
 pauseMission(id: string): Promise<void>;
 deleteMission(id: string): Promise<void>;
 saveSettings(input: SettingsInput): Promise<Settings>;
 testConnection(): Promise<{ ok: boolean; message: string }>;
 downloadEvidence(missionId: string, evidenceId: string): Promise<Asset>;
 revealAsset(id: string): Promise<void>;
 openExternal(url: string): Promise<void>;
 exportMission(id: string): Promise<{ canceled: boolean; path?: string }>;
 loadDemo(): Promise<Mission>;
 onChange(callback: (snapshot: Snapshot) => void): () => void;
}
declare global { interface Window { fieldmark?: FieldmarkAPI; } }
