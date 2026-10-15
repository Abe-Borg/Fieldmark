import { contextBridge, ipcRenderer } from 'electron';
import type { FieldmarkAPI, Snapshot } from '../src/shared/types';
const api: FieldmarkAPI = {
 getSnapshot: () => ipcRenderer.invoke('fieldmark:snapshot'),
 createMission: input => ipcRenderer.invoke('fieldmark:create', input),
 runMission: id => ipcRenderer.invoke('fieldmark:run', id),
 pauseMission: id => ipcRenderer.invoke('fieldmark:pause', id),
 deleteMission: id => ipcRenderer.invoke('fieldmark:delete', id),
 saveSettings: input => ipcRenderer.invoke('fieldmark:settings', input),
 testConnection: () => ipcRenderer.invoke('fieldmark:test'),
 downloadEvidence: (missionId, evidenceId) => ipcRenderer.invoke('fieldmark:download', missionId, evidenceId),
 revealAsset: id => ipcRenderer.invoke('fieldmark:reveal', id),
 openExternal: url => ipcRenderer.invoke('fieldmark:external', url),
 exportMission: id => ipcRenderer.invoke('fieldmark:export', id),
 loadDemo: () => ipcRenderer.invoke('fieldmark:demo'),
 onChange: callback => { const listener = (_event: unknown, snapshot: Snapshot) => callback(snapshot); ipcRenderer.on('fieldmark:changed', listener); return () => ipcRenderer.removeListener('fieldmark:changed', listener); }
};
contextBridge.exposeInMainWorld('fieldmark', api);
