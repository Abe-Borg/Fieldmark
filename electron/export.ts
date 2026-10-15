import { readFileSync, realpathSync } from 'node:fs';
import { relative, isAbsolute, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import type { Asset, Mission } from '../src/shared/types';
export function isInside(directory: string, target: string) { const path = relative(realpathSync(directory), realpathSync(target)); return !!path && !path.startsWith('..') && !isAbsolute(path); }
export function createDossier(mission: Mission, assets: Asset[], assetDirectory: string): Uint8Array {
 const files: Record<string, Uint8Array> = {};
 const relevant = assets.filter(a => a.missionId === mission.id);
 let total = 0;
 const manifest = relevant.map(asset => {
  if (!isInside(assetDirectory, asset.path)) throw new Error('A stored file is outside the asset library. Export stopped.');
  const bytes = readFileSync(asset.path); total += bytes.length;
  if (total > 300 * 1024 * 1024) throw new Error('This export exceeds 300 MB. Use the asset library to copy the individual files.');
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`The saved file ${asset.name} has changed. Download it again before exporting.`);
  const archivePath = `files/${asset.id}-${basename(asset.name).replace(/[^\w. -]/g, '_')}`;
  files[archivePath] = bytes;
  const { path: _path, ...metadata } = asset;
  return { ...metadata, archivePath };
 });
 files['manifest.json'] = strToU8(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), mission, files: manifest, applicability: 'Model applicability is a Claude assessment supported by the included sources; file signatures and hashes do not establish engineering suitability.' }, null, 2));
 const citations = mission.answer.citations.map((c, index) => `${index + 1}. ${c.title}: ${c.url}`).join('\n');
 const evidence = mission.evidence.map(e => `### ${e.title}\n\nMatch: ${e.match}\nSource: ${e.url}\n${e.page ? `Page: ${e.page}\n` : ''}${e.revision ? `Revision: ${e.revision}\n` : ''}\n${e.rationale}\n\nEvidence: ${e.excerpt}\n`).join('\n');
 files['Evidence-brief.md'] = strToU8(`# ${mission.title}\n\n${mission.demo ? '**FICTIONAL SAMPLE — no real product claims.**\n\n' : ''}Manufacturer: ${mission.manufacturer}\nModel: ${mission.model}\nProject location: ${mission.region || 'Not supplied'}\n\n## Request\n\n${mission.request}\n\n## Findings\n\n${mission.answer.text || 'No final answer recorded.'}\n\n## Citations\n\n${citations || 'None recorded.'}\n\n## Evidence\n\n${evidence || 'None recorded.'}\n\n## Unresolved\n\n${mission.unresolved.map(item => `- ${item}`).join('\n') || 'No unresolved items recorded.'}\n\n## Status\n\n${mission.status}: ${mission.stopReason || ''}\n\nDownloaded files and their SHA-256 hashes are mapped in manifest.json. External URLs may change. Source applicability assessments require engineering review.\n`);
 return zipSync(files, { level: 0 });
}
