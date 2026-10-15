import type { FieldmarkAPI, Mission, MissionInput, Settings, Snapshot } from './shared/types';
import { demoMission } from './shared/demo';

// Browser preview only: no research, downloads, credential storage, or live claims.
const storageKey = 'fieldmark-browser-preview-v1';
const settings: Settings = { model: 'claude-sonnet-5-5', maxRequests: 18, maxSearches: 32, maxDownloadMb: 100, hasApiKey: false };
let initial: Snapshot = { missions: [], assets: [], settings };
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as Snapshot | null;
  if (saved && Array.isArray(saved.missions)) initial = { ...saved, settings: { ...settings, ...saved.settings, hasApiKey: false } };
} catch { /* A damaged preview cache should not prevent the UI from loading. */ }
let state = initial;
const listeners = new Set<(snapshot: Snapshot) => void>();
function publish() {
  state = structuredClone(state);
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Session still works without browser storage. */ }
  listeners.forEach(listener => listener(structuredClone(state)));
}
function draft(input: MissionInput): Mission {
  return { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'draft', strategies: [], evidence: [], activity: [], answer: { text: '', citations: [] }, usage: { inputTokens: 0, outputTokens: 0, searches: 0, requests: 0 }, unresolved: [] };
}
const desktopOnly = async (): Promise<never> => { throw new Error('Open the installed desktop app to use Claude, download files, or export investigations. This browser is a UI preview.'); };
export const previewApi: FieldmarkAPI = {
  getSnapshot: async () => structuredClone(state),
  createMission: async input => { const mission = draft(input); state.missions.unshift(mission); publish(); return mission; },
  runMission: desktopOnly,
  pauseMission: desktopOnly,
  deleteMission: async id => { state.missions = state.missions.filter(mission => mission.id !== id); publish(); },
  saveSettings: async input => {
    if (input.apiKey) throw new Error('API keys can only be saved in the installed desktop app. No credential was stored.');
    state.settings = { model: input.model, maxRequests: input.maxRequests, maxSearches: input.maxSearches, maxDownloadMb: input.maxDownloadMb, hasApiKey: false }; publish(); return state.settings;
  },
  testConnection: desktopOnly,
  downloadEvidence: desktopOnly,
  revealAsset: desktopOnly,
  openExternal: async url => { if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); },
  exportMission: desktopOnly,
  loadDemo: async () => {
    const existing = state.missions.find(mission => mission.demo);
    if (existing) return existing;
    const mission = demoMission();
    state.missions.unshift(mission); publish(); return mission;
  },
  onChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
