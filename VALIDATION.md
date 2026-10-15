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
