# Validation record

Date: 2026-10-15. Platform: Windows x64, Node.js 24.21.0.

## Passed

- **32 automated core tests:** 19 research-engine scenarios, 9 retrieval scenarios, and 4 persistence/export/input-validation scenarios.
- **Core and frontend strict TypeScript:** `tsc --noEmit -p tsconfig.core.json`.
- **Production renderer bundle:** Vite successfully generated the React/CSS assets.
- **Desktop main/preload bundles:** esbuild successfully bundled the implementation with Electron externalized, as required for the desktop host.
- **Offline UI smoke test in installed Chrome:** rendered the initial workspace; loaded the fictional sample; filtered exact evidence; opened answer/activity tabs; verified persistence across reload; created a draft from equipment identity; rejected live execution in preview; rendered credential settings and the asset vault; no browser runtime errors.
- **Visual inspection:** initial investigation page, sample case and settings screens; improved text contrast and navigation scroll behavior.

## Meaningful behaviors covered

Source provenance and fabricated quotations; exact-match downgrade without inspected text; native-tool errors inside successful HTTP responses; preserved `pause_turn` server blocks; strict per-run search/request budgets; finishing-phase synthesis without extra web search; cancellation and resume of partial tool work; retry limits and credential redaction; consecutive tool failures; private/reserved address and credential-URL rejection; DNS pinning; rechecked robots restrictions on redirects; HTML masquerading as a file; byte caps; content hashes and corrupted-cache repair; restart recovery; corruption preservation; export containment, provenance and hash checks; representative territory requirements.

Network-oriented tests use controlled fixtures and simulated responses. They do not establish real-world manufacturer coverage or production throughput.

## Not completed in this environment

- **Online dependency installation:** npm could not resolve `registry.npmjs.org` (`ENOTFOUND`). Validation used available local packages and the official robots-parser source. No dependency lockfile was fabricated.
- **Full Electron typecheck and runtime launch:** the Electron runtime and its generated declarations were unavailable. Core/frontend checks exclude the Electron main/preload host files; their bundles compile, but that is not equivalent to an actual Electron launch.
- **Windows installer build, installation and signing:** electron-builder and the Electron distribution could not be downloaded. There is no generated `.exe` installer in this delivery. `Build-Windows.ps1` and the NSIS configuration are provided to perform the build in an environment with dependency access. Code signing is not configured.
- **Live Claude investigation:** no Anthropic key was supplied or used. All provider-loop tests use mocked responses. Actual model access, native web-tool availability, API billing, latency and resource-finding quality still require a live acceptance run.

## Next release checks

1. Run `Build-Windows.ps1` with registry and Electron download access; retain the generated lockfile.
2. Launch/install on Windows and test encrypted-key save, reload and removal; IPC operations; actual file download/reveal; ZIP export; pause/close/reopen/resume.
3. Run a real equipment case with a funded Claude API key, including one known manual, one difficult Revit/CAD retrieval, one territory lookup, and one optional-feature question.
4. Review returned model applicability against the original documents. Apply code signing before distributing an installer to users.

`Preview.html` in the source delivery is a self-contained, offline UI preview. It explicitly cannot run live research, save API credentials or perform desktop file operations.

## Follow-up verification, 2026-10-15 (Linux container, Node.js 22.22.0, npm 10.9.4)

Performed while turning the repository into an installable Windows application, selecting the license, and adding the third-party notices build step.

### Passed

- **Online dependency installation:** `npm install` resolved every package from the npm registry (313 packages). The resulting `package-lock.json` is committed; `npm ci` is now the supported install command.
- **Strict TypeScript for the whole project:** `tsc --noEmit` with the real Electron type declarations, including `electron/main.ts` and `electron/preload.ts`, which the earlier record could not check.
- **32 automated core tests:** `npm test`, unchanged scenarios, all passing.
- **Production bundles:** Vite 8.3.4 renderer bundle, esbuild 0.28.2 main and preload bundles.
- **Third-party notices:** `scripts/third-party-notices.mjs` enumerated the 9 production packages (all MIT or BSD-2-Clause), passed the permissive-license gate, and wrote `dist/THIRD-PARTY-NOTICES.txt`.
- **Icon generation:** `scripts/make-icon.mjs` rendered `build/icon.svg` with Chromium into `build/icon.png` and a nine-size `build/icon.ico` (16 to 256 px); legibility checked at 16, 24, 32, 48 and 256 px.
- **Offline UI smoke test:** `npm run test:ui` against the Chromium build in the container: initial page, sample, filters, answer, activity, persistence, default draft request, live-mode rejection, settings, vault; no browser errors.
- **Unpacked Windows build:** `electron-builder --dir --win --x64` downloaded Electron 44.7.2 and produced `release/win-unpacked`. `Fieldmark.exe` carries ProductName `Fieldmark`, CompanyName `Abraham Borg`, the copyright string and version 0.1.0; all nine icon images are embedded in it; `resources/LICENSE.txt` (CRLF, as NSIS requires) and `resources/THIRD-PARTY-NOTICES.txt` sit beside `app.asar`; `LICENSE.electron.txt` and `LICENSES.chromium.html` are in the application root. Signing was skipped with an informational message because no certificate is configured.
- **Package contents:** excluding `node_modules` from the asar (every dependency is already bundled by esbuild and Vite) reduced `app.asar` from 17.9 MB to 1.8 MB; the bundle's only imports are `electron` and Node builtins. The smoke-test preview page is excluded as well.
- **License text integrity:** `LICENSE.txt` was generated from the official `PolyForm-Strict-1.0.0.md` in the PolyForm Project repository and checked word for word against it (549 words identical); only Markdown markers were removed and lines were wrapped.

### Not completed in this environment

- **NSIS installer:** electron-builder downloaded NSIS and its resources but needs Wine on Linux to finish the installer, which this container does not have. The installer must be produced on Windows with `npm run package:win` or `Build-Windows.ps1`. The installer EULA page, shortcuts, install and uninstall flow, and first launch of the installed application therefore remain unverified.
- **Live Claude investigation:** unchanged; no API key was supplied or used.

### Next release checks

In addition to the list above: build the installer on Windows, confirm the license page appears and must be accepted, confirm the installed `Fieldmark.exe` shows the Fieldmark icon in Explorer, the taskbar, and Programs and Features, and confirm `resources\LICENSE.txt` and `resources\THIRD-PARTY-NOTICES.txt` are present in the installation directory.
