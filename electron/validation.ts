import { z } from 'zod';
export const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export function publicUrlSyntax(value: string) {
 const url = new URL(value);
 if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Use a public HTTP or HTTPS URL without credentials.');
 return url.toString();
}
export const missionInputSchema = z.object({
 title: z.string().trim().min(1).max(180), manufacturer: z.string().trim().max(160), model: z.string().trim().max(160),
 kind: z.enum(['manuals', 'revit', 'cad', 'representative', 'capability', 'everything']), request: z.string().trim().min(3).max(12000), region: z.string().trim().max(300), depth: z.enum(['focused', 'thorough', 'exhaustive']), seedUrls: z.array(z.string().max(4000).refine(value => { try { publicUrlSyntax(value); return true; } catch { return false; } }, 'Use a public HTTP or HTTPS URL without credentials.').transform(publicUrlSyntax)).max(15)
}).strict().refine(value => value.kind !== 'representative' || value.region.length > 0, { message: 'A project location is required to check representative territory.', path: ['region'] });
export const settingsSchema = z.object({ model: z.string().trim().regex(/^claude-[a-zA-Z0-9-]{1,90}$/), maxRequests: z.number().int().min(2).max(80), maxSearches: z.number().int().min(1).max(150), maxDownloadMb: z.number().int().min(1).max(250), apiKey: z.string().trim().max(1000).optional(), clearApiKey: z.boolean().optional() }).strict();
