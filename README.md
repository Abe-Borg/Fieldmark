# Fieldmark

**Find the engineering resource. Keep the evidence.**

Fieldmark is a Windows desktop application for finding equipment manuals, cutsheets, Revit families, CAD files, manufacturer representatives, and answers about product capabilities. Claude drives a persistent investigation; the application manages source provenance, local file checks, a reusable evidence library, interruption recovery, and project-ready exports.

## Current build status

This is an implemented development version, not a published or signed release. See [VALIDATION.md](VALIDATION.md) for what has actually been tested and the remaining release gates. Live research requires the user's own Anthropic API key and API billing. A fictional sample investigation works without a key.

## What makes it different

- **Saved investigations:** requested equipment identity, search strategy, attempted avenues, sources, findings, and unresolved questions survive restarts. Pause and resume with a new bounded run budget.
- **A broader search ladder:** official product and document libraries, regional sites, old product/brand names, distributors, BIM/CAD catalogs, and legitimate public archives. Claude selects the next useful action, rather than running one fixed search query.
- **Source-backed applicability:** exact, family, alternative, and unverified matches are separate. Exact assessments need an excerpt present in retrieved source text. An observed URL or a correct file extension alone cannot establish an exact match.
- **Actual file retrieval:** validate public destinations, redirects, HTTP status, size and file signatures; reject executables and HTML login pages pretending to be PDFs; save content-addressed files with SHA-256 hashes. Revit compound-file signatures do not establish Revit version or family suitability.
- **A reusable local asset vault:** search filenames, reopen file locations, and reuse recovered resources. Files are never executed or automatically unpacked.
- **Evidence packages:** export a ZIP containing the evidence brief, full structured investigation, citations, unresolved items, original downloaded files, and a manifest mapping hashes to sources. Detect changed files before export.
- **Useful unsuccessful outcomes:** record access restrictions, ambiguous models, conflicting sources and budget exhaustion without claiming that a resource does not exist.

## Build and run on Windows

Requirements: Windows 10/11 x64, Node.js 22.12 or newer (24 LTS recommended) with npm, and internet access to the npm registry and Electron release downloads. Application users will not need Node once an installer is built.

```powershell
cd fieldmark
npm ci
npm test
npm run dev
```

`package-lock.json` is committed, so `npm ci` installs the exact dependency versions that were verified. Use `npm install` only when you intend to change dependencies, then commit the updated lockfile.

To build a per-user Windows installer:

```powershell
npm run package:win
```

The installer is written to `release/Fieldmark-Setup-<version>.exe`, with the version taken from `package.json`. No administrator installation is required. The installer shows the license as a click-through agreement that must be accepted before installation, lets the user choose the destination directory, and creates desktop and Start menu shortcuts. The installed `Fieldmark.exe` carries the Fieldmark icon, product name, version, and copyright, and the installation's `resources` folder contains `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt` next to Electron's own license files. Uninstalling leaves the user's investigations and asset vault in place.

For a single command that installs dependencies, tests, and packages, run `./Build-Windows.ps1`. The script stops on errors and confirms that the installer file exists before reporting success.

Notes for packaging:

- On the first packaging run electron-builder downloads the Electron runtime and its Windows resource-editing tools and caches them in the local application data folder for later builds.
- If that tool download fails to extract with a symbolic-link privilege error, enable Developer Mode in Windows Settings (System, For developers) or run the build once from an elevated PowerShell. The extracted tools are reused afterwards.
- Code signing is not configured. electron-builder signs the executable and installer automatically when a certificate is supplied through its standard `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` environment variables. Without one it produces unsigned binaries, and Windows SmartScreen will warn users until a signed installer is distributed. Never commit certificate files; `*.pfx` and `*.p12` are ignored by git.
- The application icon is rendered from `build/icon.svg` by `npm run icon`, which uses the Playwright Chromium driver against an installed Chrome or Edge (or `FIELDMARK_BROWSER=<path>`). The generated `build/icon.png` and `build/icon.ico` are committed, so the icon step is only needed after editing the SVG.
- `npm run build` also runs `npm run licenses`, which writes `dist/THIRD-PARTY-NOTICES.txt` from the installed production dependencies and stops the build if any of them is outside the permissive license allowlist. See [License](#license).

## First investigation

1. Open **Settings**. Enter a Claude API key and save it. It is encrypted through Windows credential protection in the Electron main process and is never returned to the web interface.
2. Test the connection. This checks model access; web search also needs to be enabled for your organization in the Claude Console.
3. Create an investigation. Select a task, enter the manufacturer and complete model, explain what you need, and add the project location for representative searches. Include voltage, frequency, generation, desired Revit version and optional features where relevant.
4. Add known public product or document URLs when available. Choose a research depth and start.
5. Review the evidence, its applicability rationale and unresolved issues. Select **Download** for the files you want to retain, then export an evidence package.

The sample uses a fictional manufacturer and `example.com` addresses. It makes no product claims, performs no API calls, and has no actual downloadable files.

## Research depth and spending controls

| Depth | Maximum API attempts per run | Maximum searches per run | Claude effort |
| --- | ---: | ---: | --- |
| Focused | 8 | 4 | Medium |
| Thorough | 24 | 12 | Medium |
| Exhaustive | Settings limit | Settings limit | High |

The configured Settings limits always take precedence if lower. Default limits are 18 API attempts, 32 searches and 100 MB per downloaded file. Counters in the case aggregate all runs; each explicit resume grants a new run budget. API attempts include retries. Up to three requests are reserved for inspecting existing leads and producing a checkpoint report after the search allowance is exhausted; that separate finishing phase has no native web-search or web-fetch tool. One native search is allowed per research request to preserve a strict cross-request budget. These are operation limits, not a guaranteed dollar cap; token usage, thinking, provider tools and unsuccessful requests can incur charges. The app displays usage rather than estimating a misleading exact bill.

The default model is `claude-sonnet-5-5`; Settings accepts another available Claude model ID. The implementation uses current native web search/fetch tools and configurable model selection. Connection testing reports unavailable model access. Older models may not support the chosen tools or effort parameter.

## Architecture

| Layer | Responsibility |
| --- | --- |
| React renderer | Investigation forms, evidence review, activity trace, vault, settings |
| Sandboxed preload | Small typed IPC bridge; no arbitrary filesystem, shell, or API access |
| Electron main process | Validated IPC, credential encryption, lifecycle, downloads and export dialogs |
| Research engine | Anthropic Messages tool loop, bounded retries, checkpoints, source register, applicability checks |
| Retrieval tools | DNS-pinned public HTTP(S), robots rules, per-host pacing, redirects, extraction, file validation |
| Local store | Atomic JSON snapshots, full conversation checkpoints, encrypted credential file, hashed asset files |

The current store is local and single-user. It deliberately has no application server, shared database, email integration, telemetry, automatic updates, background monitor or subscription backend.

## Access and data behavior

Searches and research context are sent directly to Anthropic. Public source servers receive requests from the user's computer when local page inspection or file retrieval is used. API keys stay in the main process and are sent only to `api.anthropic.com`. The renderer loads only local bundled content, denies browser permissions and external navigation, and opens source links in the user's normal browser on request.

Local tools accept public HTTP/HTTPS destinations on standard ports, reject credentials in URLs and private/reserved addresses, revalidate redirects, and pin the validated DNS address to the connection. They honor robots restrictions and rate limits. Native Anthropic tools follow the provider's own retrieval behavior. Login portals, CAPTCHAs, paywalls and private systems are recorded as handoff leads; there is no access-control bypass, identity impersonation, automatic account creation, purchase or outbound correspondence.

Downloaded files are stored in the app's `assets` directory under Electron's per-user application data folder. Removing an investigation does not erase previously downloaded files from the vault. Local histories contain research inputs and fetched source material; do not enter information you are not permitted to send to Anthropic. Keys are not exported in dossiers.

## Current limits and planned next work

- Live Claude integration still needs an end-to-end run with a funded key. Mocked provider tests do not establish retrieval quality on real manufacturers.
- No automatic login, interactive browser automation, OCR for scanned documents, Revit API inspection or CAD geometry inspection. A user can open a blocked source in their browser; its authenticated session is not imported.
- Revit files can be downloaded and their container signature checked, but version, parameters, connectors, geometry and compatibility remain unverified.
- Excerpt checks are deterministic string checks, not an engineering certification. Claude can still misunderstand model applicability, options, territory or revisions.
- Local JSON persistence and sequential investigations suit an individual desktop workflow. A team deployment needs database migration, access controls, curated manufacturer adapters and shared evidence records.
- The ZIP exporter has a 300 MB aggregate file limit. Larger assets can be copied from the vault.

Useful next product increments are manufacturer-specific adapters, user-controlled authenticated browsing, PDF page extraction/OCR, Revit version and parameter inspection, document revision comparisons, and repeatable real-manufacturer retrieval evaluations.

## Implementation references

Verified against the official documentation on 2026-10-15:

- [Claude models](https://platform.claude.com/docs/en/models/overview)
- [Claude web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [Claude web fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)
- [Server tool continuations](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/)
- [Electron credential storage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [NSIS installer configuration](https://www.electron.build/nsis/)
- [PolyForm Strict License 1.0.0](https://polyformproject.org/licenses/strict/1.0.0)

## License

Fieldmark is proprietary software, copyright Abraham Borg, made available under the [PolyForm Strict License 1.0.0](https://polyformproject.org/licenses/strict/1.0.0). The complete text is in [LICENSE.txt](LICENSE.txt), which the Windows installer presents as a click-through agreement. In summary, and subject to the license text itself:

- Anyone may install and use Fieldmark for noncommercial purposes: personal study, hobby projects, research and testing for public knowledge, and use by charitable, educational, public research, public safety or health, environmental protection, and government organizations.
- Nobody may distribute Fieldmark, modify it, or make new works based on it.
- Commercial use is not granted by the license. It requires separate written permission from the copyright holder, who may grant it on any terms, for example a paid commercial license for a design firm.
- The software is provided as is, without warranty or condition, and without liability for damages, as far as the law allows.

This is the most restrictive standardized license the project can carry, and the choice was made after reviewing every component shipped in the application. All production dependencies bundled into the app (React, react-dom, scheduler, zod, parse5, entities, ipaddr.js, fflate, robots-parser) are under the MIT or BSD-2-Clause licenses. The Electron runtime (MIT), Chromium (BSD-3-Clause and the licenses of its components), Node.js (MIT and the licenses of its components), and the NSIS installer (zlib/libpng) are likewise permissive. None of them carries copyleft or source-disclosure obligations, so none restricts the license on Fieldmark's own code. Their only requirement is that their copyright notices and license texts accompany the application. The build satisfies this by generating `THIRD-PARTY-NOTICES.txt` from the installed dependency tree (`npm run licenses`) and packaging it in the installation's `resources` folder beside `LICENSE.txt`; Electron and Chromium notices are placed in the application folder by electron-builder. The same script fails the build if a production dependency is ever added under a license outside the permissive allowlist in `scripts/third-party-notices.mjs`.

Development-only tools (TypeScript and Playwright under Apache-2.0; Vite, esbuild, tsx, electron-builder and their dependencies, including a few MPL-2.0, WTFPL, and Python-2.0 packages such as lightningcss and argparse) are not distributed with the application and create no obligations for its users. The source tree contains no copied third-party code; the UI icons in `src/icons.tsx` are original hand-drawn paths.

The license text is a published legal document that has not been reviewed by a lawyer for this specific product. Have an attorney confirm it meets your goals before a commercial release.
