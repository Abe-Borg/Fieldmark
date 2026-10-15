// Collects the license of every production dependency bundled into the desktop app,
// fails the build if any of them is not on the permissive allowlist, and writes the
// combined notices file that ships beside the application (resources/THIRD-PARTY-NOTICES.txt).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const output = join(root, 'dist', 'THIRD-PARTY-NOTICES.txt');

// Only licenses that place no copyleft or source-disclosure obligation on Fieldmark may be bundled.
// Attribution-only terms are satisfied by this notices file. Anything else must be reviewed before it is added.
const ALLOWED = new Set(['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'BlueOak-1.0.0', 'Zlib', 'Unlicense', 'CC0-1.0', 'Python-2.0']);

function licenseOf(pkg) {
  const raw = pkg.license ?? pkg.licenses;
  if (Array.isArray(raw)) return raw.map(item => (typeof item === 'string' ? item : item?.type)).filter(Boolean).join(' OR ');
  if (raw && typeof raw === 'object') return raw.type ?? '';
  return typeof raw === 'string' ? raw : '';
}
function acceptable(expression) {
  const text = expression.trim().replace(/^\(|\)$/g, '');
  if (!text) return false;
  if (/\bOR\b/.test(text)) return text.split(/\s+OR\s+/).some(part => acceptable(part));
  if (/\bAND\b/.test(text)) return text.split(/\s+AND\s+/).every(part => acceptable(part));
  return ALLOWED.has(text);
}
function productionPackages() {
  const args = ['ls', '--omit=dev', '--all', '--parseable'];
  const options = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  let listing;
  try {
    listing = process.env.npm_execpath
      ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], options)
      : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { ...options, shell: process.platform === 'win32' });
  } catch (error) {
    if (!error.stdout) throw new Error(`npm ls failed: ${error.message}`);
    listing = error.stdout; // npm still prints the tree when it also reports problems.
  }
  return [...new Set(listing.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => resolve(line)))].filter(path => path !== root).sort();
}
function licenseFiles(directory) {
  return readdirSync(directory)
    .filter(name => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(name) && statSync(join(directory, name)).isFile())
    .sort();
}

const packages = productionPackages();
if (packages.length === 0) throw new Error('No production dependencies were found. Run npm install first.');
const rejected = [];
const sections = [];
for (const directory of packages) {
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const license = licenseOf(pkg);
  if (!acceptable(license)) rejected.push(`${pkg.name}@${pkg.version}: ${license || 'no license declared'}`);
  const texts = licenseFiles(directory).map(name => readFileSync(join(directory, name), 'utf8').trim());
  const source = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? '';
  sections.push([
    `${pkg.name} ${pkg.version}`,
    `License: ${license || 'not declared'}`,
    source ? `Source: ${source.replace(/^git\+/, '').replace(/\.git$/, '')}` : '',
    '',
    texts.length ? texts.join('\n\n') : `(The package does not ship a license file. Its package.json declares ${license || 'no license'}.)`
  ].filter((line, index) => line !== '' || index !== 2).join('\n'));
}
if (rejected.length) {
  console.error('Build stopped: these production dependencies are not on the permissive license allowlist and would conflict with the Fieldmark license policy.\n  ' + rejected.join('\n  '));
  process.exit(1);
}
const separator = '\n\n' + '='.repeat(78) + '\n\n';
const header = [
  `Fieldmark ${own.version} - Third-party notices`,
  `Generated ${new Date().toISOString().slice(0, 10)}`,
  '',
  'Fieldmark itself is proprietary software; its terms are in LICENSE.txt in this directory.',
  'The open-source components listed below are bundled into the application and remain under',
  'their own licenses, reproduced here as those licenses require. They are used without modification.',
  '',
  'The Electron runtime (MIT), Chromium (BSD-3-Clause and the licenses of its own components), and',
  'Node.js (MIT and the licenses of its own components) are distributed alongside the application.',
  'Their notices are in LICENSE.electron.txt and LICENSES.chromium.html in the application directory.',
  'The installer is produced with NSIS (zlib/libpng license).'
].join('\n');
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(output, `${header}${separator}${sections.join(separator)}\n`);
console.log(`Third-party notices written for ${packages.length} production packages: ${output}`);
