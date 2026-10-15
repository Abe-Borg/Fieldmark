import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { Store, atomicWrite } from './store';
import { ResearchEngine } from './research';
import { ResearchTools, parsePublicUrl } from './research-tools';
import { identifier, missionInputSchema, publicUrlSyntax, settingsSchema } from './validation';
import { createDossier, isInside } from './export';
import { demoMission } from '../src/shared/demo';

const here = dirname(fileURLToPath(import.meta.url));
const appPage = pathToFileURL(join(here, '../dist/index.html')).toString();
const devUrl = !app.isPackaged && process.env.FIELDMARK_DEV_URL === 'http://127.0.0.1:5173' ? process.env.FIELDMARK_DEV_URL : undefined;
let window: BrowserWindow | null = null;
let store: Store;
let engine: ResearchEngine;
let researchTools: ResearchTools;
let assetDirectory: string;
let keyFile: string;
const downloads = new Set<string>();
if (!app.requestSingleInstanceLock()) app.quit();
else {
 app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
 app.whenReady().then(initialize).catch(error => { dialog.showErrorBox('Fieldmark could not start', error instanceof Error ? error.message : 'Startup failed.'); app.quit(); });
}

function validateSender(event: IpcMainInvokeEvent) {
 const url = event.senderFrame?.url;
 if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame || !(url === appPage || (devUrl && url?.startsWith(`${devUrl}/`)))) throw new Error('Untrusted application request.');
}
function handle(channel: string, listener: (...args: any[]) => any) {
 ipcMain.handle(`fieldmark:${channel}`, async (event, ...args) => { validateSender(event); return listener(...args); });
}
async function getApiKey() {
 if (!existsSync(keyFile)) throw new Error('Add your Claude API key in Settings first.');
 if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
 const decrypted = await safeStorage.decryptStringAsync(readFileSync(keyFile));
 return decrypted.result;
}
function refreshKeyStatus() { const settings = store.getSettings(); settings.hasApiKey = existsSync(keyFile); store.saveSettings(settings); }
async function initialize() {
 app.setAppUserModelId('app.fieldmark.desktop');
 const dataDirectory = app.getPath('userData');
 store = new Store(dataDirectory);
 assetDirectory = join(dataDirectory, 'assets'); mkdirSync(assetDirectory, { recursive: true });
 keyFile = join(dataDirectory, 'claude-key.encrypted');
 refreshKeyStatus();
 researchTools = new ResearchTools({ assetDirectory, maxDownloadMb: () => store.getSettings().maxDownloadMb });
 engine = new ResearchEngine({ getMission: id => store.getMission(id), saveMission: mission => store.saveMission(mission), getSettings: () => store.getSettings(), getApiKey, tools: researchTools, getHistory: id => store.getHistory(id), saveHistory: (id, history) => store.saveHistory(id, history) });
 store.onChange = () => { if (window && !window.isDestroyed()) window.webContents.send('fieldmark:changed', store.snapshot()); };
 session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
 session.defaultSession.setPermissionCheckHandler(() => false);
 handle('snapshot', () => store.snapshot());
 handle('create', input => store.createMission(missionInputSchema.parse(input)));
 handle('run', async value => {
  const id = identifier.parse(value); const mission = store.getMission(id);
  if (mission.demo) throw new Error('The sample cannot run live research. Create a new investigation.');
  if (!store.getSettings().hasApiKey) throw new Error('Add your Claude API key in Settings first.');
  if (engine.isRunning(id)) return;
  if (store.snapshot().missions.some(m => engine.isRunning(m.id))) throw new Error('Another investigation is running. Pause it before starting this one.');
  void engine.run(id).catch(error => {
   const current = store.getMission(id); current.status = 'failed'; current.stopReason = error instanceof Error ? error.message : 'Research failed.'; store.saveMission(current);
  });
 });
 handle('pause', value => { const id = identifier.parse(value); store.getMission(id); engine.pause(id); });
 handle('delete', value => { const id = identifier.parse(value); if (engine.isRunning(id) || [...downloads].some(key => key.startsWith(`${id}:`))) throw new Error('Pause research and wait for downloads before removing an investigation.'); store.deleteMission(id); });
 handle('settings', async value => {
  if (store.snapshot().missions.some(m => engine.isRunning(m.id))) throw new Error('Pause research before changing its settings.');
  const input = settingsSchema.parse(value);
  if (input.apiKey && input.clearApiKey) throw new Error('Choose either replacing or clearing the key.');
  if (input.apiKey) { if (!input.apiKey.startsWith('sk-ant-')) throw new Error('Enter a valid Anthropic API key.'); if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. The key was not saved.'); atomicWrite(keyFile, await safeStorage.encryptStringAsync(input.apiKey)); }
  if (input.clearApiKey && existsSync(keyFile)) unlinkSync(keyFile);
  return store.saveSettings({ model: input.model, maxRequests: input.maxRequests, maxSearches: input.maxSearches, maxDownloadMb: input.maxDownloadMb, hasApiKey: existsSync(keyFile) });
 });
 handle('test', async () => {
  const key = await getApiKey();
  try {
   const response = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(store.getSettings().model)}`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20000) });
   if (!response.ok) return { ok: false, message: response.status === 401 ? 'Claude rejected the API key.' : response.status === 404 ? 'This model is not available to this API account. Check the model ID.' : `Claude returned HTTP ${response.status}. Check your account access and retry.` };
   const model = await response.json(); return { ok: true, message: `Connected. ${model.display_name || model.id || 'Selected model'} is available. Web search must also be enabled in your Claude Console.` };
  } catch { return { ok: false, message: 'Could not reach Claude. Check your internet connection or firewall and retry.' }; }
 });
 handle('download', async (missionValue, evidenceValue) => {
  const missionId = identifier.parse(missionValue); const evidenceId = identifier.parse(evidenceValue);
  const mission = store.getMission(missionId); if (mission.demo) throw new Error('Sample files are fictional. Start an investigation to download real files.');
  const evidence = mission.evidence.find(e => e.id === evidenceId); if (!evidence) throw new Error('Evidence not found.');
  const key = `${missionId}:${evidenceId}`; if (downloads.has(key)) throw new Error('This file is already downloading.');
  downloads.add(key);
  try { return store.addAsset(await researchTools.downloadAsset(evidence.url, missionId, evidenceId)); }
  finally { downloads.delete(key); }
 });
 handle('reveal', value => { const asset = store.getAsset(identifier.parse(value)); if (!isInside(assetDirectory, asset.path)) throw new Error('The file is outside the asset library.'); shell.showItemInFolder(asset.path); });
 handle('external', async value => { if (typeof value !== 'string' || value.length > 4000) throw new Error('Invalid link.'); await shell.openExternal(parsePublicUrl(value).href); });
 handle('export', async value => {
  const mission = store.getMission(identifier.parse(value));
  const result = await dialog.showSaveDialog(window!, { title: 'Export evidence package', defaultPath: `${mission.title.replace(/[^\w -]/g, '_').slice(0,80)}.zip`, filters: [{ name: 'Evidence package', extensions: ['zip'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  atomicWrite(result.filePath, Buffer.from(createDossier(mission, store.snapshot().assets, assetDirectory)));
  return { canceled: false, path: result.filePath };
 });
 handle('demo', () => { const demo = demoMission(); store.saveMission(demo); return demo; });
 createWindow();
 app.on('activate', () => { if (!window) createWindow(); });
}
function createWindow() {
 window = new BrowserWindow({ width: 1450, height: 940, minWidth: 980, minHeight: 680, title: 'Fieldmark', backgroundColor: '#f5f4ef', autoHideMenuBar: true, webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
 window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
 window.webContents.on('will-navigate', event => event.preventDefault());
 window.webContents.on('will-attach-webview', event => event.preventDefault());
 window.on('closed', () => { window = null; });
 void window.loadURL(devUrl || appPage);
}
app.on('before-quit', () => { if (store && engine) for (const mission of store.snapshot().missions) if (engine.isRunning(mission.id)) engine.pause(mission.id); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
