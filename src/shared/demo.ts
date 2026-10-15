import type { Mission } from './types';
export function demoMission(): Mission {
 const at = new Date().toISOString();
 return {
  id: 'fieldmark-sample', title: 'AXR-1200 · equipment resource package', manufacturer: 'Example Airworks', model: 'AXR-1200', kind: 'everything', request: 'Find the installation manual, Revit family, and evidence of BACnet support for a 460 V unit.', region: 'Orange County, CA', depth: 'thorough', seedUrls: [], status: 'complete', demo: true, createdAt: at, updatedAt: at,
  strategies: [
   { id: 'identity', title: 'Establish equipment identity', detail: 'Illustrative 460 V variant separated from 208 V.', status: 'done' },
   { id: 'official', title: 'Search manufacturer sources', detail: 'Illustrative product page and technical library.', status: 'done' },
   { id: 'expanded', title: 'Follow the harder leads', detail: 'Illustrative regional BIM catalog reviewed.', status: 'done' },
   { id: 'verify', title: 'Check applicability and files', detail: 'Illustrative manual coverage established; Revit version unresolved.', status: 'done' },
   { id: 'synthesize', title: 'Build the evidence brief', detail: 'Example findings with explicit limitations.', status: 'done' }
  ],
  evidence: [
   { id: 'sample-manual', title: 'AXR series — installation and operation manual', url: 'https://example.com/fieldmark-sample/manual.pdf', sourceType: 'manufacturer', kind: 'PDF manual', match: 'exact', rationale: 'Sample only: the model table includes AXR-1200 / 460 V.', excerpt: 'Illustrative excerpt: AXR-1200 — 460 V, 3 phase, 60 Hz.', page: '6', model: 'AXR-1200', revision: 'Example rev. C', discoveredAt: at },
   { id: 'sample-bim', title: 'AXR packaged rooftop unit — Revit family', url: 'https://example.com/fieldmark-sample/axr.rfa', sourceType: 'bim-library', kind: 'Revit family', match: 'family', rationale: 'Sample only: series matches; exact type parameters and Revit version have not been inspected.', excerpt: 'Illustrative catalog entry lists the AXR product family.', discoveredAt: at },
   { id: 'sample-controls', title: 'AXR controls — BACnet option', url: 'https://example.com/fieldmark-sample/controls.pdf', sourceType: 'manufacturer', kind: 'Controls guide', match: 'unverified', rationale: 'Sample only: optional support does not establish that the requested unit includes it.', excerpt: 'Illustrative excerpt: BACnet MS/TP available with optional communication card.', page: '12', discoveredAt: at }
  ],
  activity: [
   { id: 'demo-1', at, type: 'info', message: 'Sample investigation loaded. No searches or API calls were made.' },
   { id: 'demo-2', at, type: 'finding', message: 'Example: model and voltage coverage distinguished from a similar model.' },
   { id: 'demo-3', at, type: 'warning', message: 'Example: Revit compatibility and installed BACnet option remain unresolved.' }
  ],
  answer: { text: 'This is a fictional demonstration of a finished evidence brief.\n\nManual: the sample shows how exact model and voltage coverage would be documented.\n\nRevit: a family-level match needs its supported Revit version and type parameters checked before use.\n\nBACnet: the sample describes an optional communication card. Optional availability does not prove it is installed in the specified unit.\n\nCreate a new investigation to research real equipment.', citations: [] },
  usage: { inputTokens: 0, outputTokens: 0, searches: 0, requests: 0 }, unresolved: ['Illustrative: determine supported Revit versions.', 'Illustrative: confirm whether the equipment includes the optional BACnet card.'], stopReason: 'Fictional sample. No real product claims or downloadable files.'
 };
}
