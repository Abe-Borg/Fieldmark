# CLAUDE.md

Guidance for Claude Code sessions working in this repository. Keep it current when commands, architecture, or policies change.

## What Fieldmark is

Fieldmark is a proprietary Windows desktop application for engineers who need equipment manuals, cutsheets, Revit families, CAD files, manufacturer representatives, and source-backed answers about product capabilities. Claude (through the user's own Anthropic API key) drives a persistent investigation; the app keeps provenance, validates and hashes downloaded files, stores a local evidence library, survives interruptions, and exports evidence packages. The owner and copyright holder is Abraham Borg, who works in mechanical and fire sprinkler design for nonresidential and hyperscale data center projects. If fire-protection references ever come up, use the latest edition of NFPA 13.

Stack: Electron 44 (ESM main process, sandboxed CommonJS preload), React 19 + TypeScript renderer bundled by Vite 8, esbuild for the main/preload bundles, zod for IPC validation, node:test via tsx for tests, Playwright for the offline UI smoke test, electron-builder (NSIS) for the Windows installer. Node.js 22.12+ is required; 24 LTS is recommended on Windows.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the exact versions in `package-lock.json`. Use `npm install` only to change dependencies, then commit the lockfile. |
| `npm run dev` | Bundle main/preload, start Vite on 127.0.0.1:5173, launch Electron against it. |
| `npm test` | 33 node:test scenarios (research engine, retrieval tools, store/export/validation, license policy). Fixtures only; no live network. |
| `npx tsc --noEmit` | Full strict typecheck, including the Electron host files. `npm run check:core` excludes `electron/main.ts` and `electron/preload.ts`. |
| `npm run build` | Typecheck, renderer bundle to `dist/`, main/preload to `dist-electron/`, then `scripts/third-party-notices.mjs`. |
| `npm run test:ui` | Playwright smoke test of the offline preview built from `dist/`. Needs Chrome or Edge installed, or `FIELDMARK_BROWSER=<path to a Chromium executable>`. |
| `npm run licenses` | Regenerate `dist/THIRD-PARTY-NOTICES.txt` and fail if any production dependency is not acceptable under `scripts/license-policy.mjs`. |
| `npm run icon` | Re-render `build/icon.png` and the multi-size `build/icon.ico` from `build/icon.svg` (uses Playwright/Chromium like `test:ui`). |
| `npm run package:win` | `build` then electron-builder NSIS x64 installer into `release/`. Windows only in practice. |
| `./Build-Windows.ps1` | Install, test, and package in one step; verifies the installer file exists. |

Environment notes: on Linux/CI without GitHub release access set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` before `npm ci`; everything except `dev`, `start`, and packaging still works. Scripts in `scripts/` are plain Node ESM and must stay cross-platform (no shell-specific syntax in `package.json` scripts beyond what is already there).

## Layout

| Path | Contents |
| --- | --- |
| `electron/main.ts` | App lifecycle, single instance, window creation, permission denial, validated IPC handlers (`handle()` prefixes channels with `fieldmark:` and checks the sender frame), encrypted API key via `safeStorage`, downloads, export dialog. |
| `electron/preload.ts` | The only renderer bridge: `window.fieldmark` implementing `FieldmarkAPI`. |
| `electron/research.ts` | Anthropic Messages tool loop: budgets per run, checkpoints, source register, applicability rules, finishing phase. |
| `electron/research-tools.ts` | Public HTTP(S) retrieval: URL/IP policy, DNS pinning, robots.txt, per-host pacing, redirects, HTML extraction, file signature classification, hashed asset storage. |
| `electron/store.ts` | Atomic JSON workspace under Electron `userData`, per-mission history files, asset registry. |
| `electron/export.ts` | Evidence package ZIP (fflate) with manifest, hash checks, path containment. |
| `electron/validation.ts` | zod schemas for IPC inputs. |
| `src/` | React renderer (`App.tsx`, `styles.css`, hand-drawn `icons.tsx`), `preview.ts` (browser-only API that rejects desktop features), `shared/` types and the fictional demo mission. |
| `tests/` | node:test suites. |
| `scripts/` | dev runner, esbuild bundling, offline preview builder, UI smoke test, license policy (`license-policy.mjs` with a `.d.mts` declaration so tests can import it), third-party notices, icon generator. |
| `build/` | electron-builder resources: `icon.svg` (source), `icon.png`, `icon.ico`. |
| `LICENSE.txt` | PolyForm Strict 1.0.0 with the Fieldmark notice header; also the installer EULA page. Stored with CRLF via `.gitattributes` because NSIS requires it. |
| `Preview.html` | Self-contained offline UI preview from the original delivery. Not used by the build. |

## Architecture and security invariants

- The renderer is sandboxed (`contextIsolation`, `sandbox: true`, no `nodeIntegration`, navigation and window opening denied, all permission requests denied). It never touches the filesystem, shell, or network directly; everything goes through `FieldmarkAPI`.
- To add an IPC operation: add the method to `FieldmarkAPI` in `src/shared/types.ts`, expose it in `electron/preload.ts`, register it with `handle()` in `electron/main.ts` with a zod schema from `electron/validation.ts`, and give `src/preview.ts` a browser implementation or the `desktopOnly` rejection.
- Retrieval stays lawful and conservative: public HTTP/HTTPS on ports 80/443 only, no credentials in URLs, private/reserved/multicast addresses blocked, resolved address pinned to the connection, robots.txt honored (including on redirects), crawl delays respected, byte caps enforced, executables and HTML-as-file rejected, archives never unpacked or executed. Never add code that bypasses logins, CAPTCHAs, paywalls, robots rules, or rate limits, impersonates a person, or sends outbound communications.
- Exact-match evidence requires an excerpt present in retrieved source text. Do not weaken that rule.
- The API key is encrypted with Windows credential protection in the main process, never returned to the renderer, and sent only to `api.anthropic.com`.
- The store is local and single-user by design: no server, telemetry, auto-update, or background services. Do not add them without the owner's direction.
- Keep `npm test` and `npx tsc --noEmit` green. Add node:test coverage in `tests/` for engine, tool, store, or export changes, using fixtures rather than live network.

## Code style

- TypeScript strict mode, ESM, single quotes, semicolons. The code is intentionally dense: long single-line statements and compact JSX are the norm. Match the indentation of the file you are editing (some files use one space, others two).
- UI icons are hand-drawn SVG paths in `src/icons.tsx`; do not add an icon library.
- User-facing text is plain, specific, and avoids overclaiming (for example, file signatures never imply engineering suitability).

## Windows packaging

- electron-builder configuration lives in `package.json` under `build`: per-user NSIS installer for x64, asar enabled, `build/icon.ico`, EULA page from `LICENSE.txt`, `extraResources` placing `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt` in the installed `resources` folder, `publish` disabled.
- The asar contains only `dist/`, `dist-electron/`, and `package.json`. `node_modules` is excluded because esbuild and Vite bundle every dependency into those outputs; the main bundle imports nothing but `electron` and Node builtins. If a dependency is ever needed at runtime without bundling (for example a native module), remove the `!node_modules/**/*` exclusion for it and add it to `asarUnpack` as needed.
- The version lives only in `package.json`; `Build-Windows.ps1` and the installer name read it from there.
- Resource editing (icon, product name, version, copyright) is enabled. Code signing happens automatically when the owner supplies a certificate through electron-builder's `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` environment variables; never commit certificates (`*.pfx` and `*.p12` are gitignored).
- Releases are cut manually by the owner. Do not add publish or auto-update configuration.

## License policy

- Fieldmark is licensed under the PolyForm Strict License 1.0.0 (noncommercial use only, no distribution, no changes or derivative works, no warranty or liability). `LICENSE.txt` is the official text plus a notice header; do not edit the license wording. Changing the license is the owner's decision.
- Every production dependency must satisfy `scripts/license-policy.mjs`, which evaluates the package's SPDX expression against the permissive allowlist (MIT, ISC, 0BSD, BSD-2/3-Clause, Apache-2.0, BlueOak-1.0.0, Zlib, Unlicense, CC0-1.0, Python-2.0); `AND` requires every operand to be allowed, `OR` any operand, and `WITH` exceptions are rejected until reviewed. `tests/license-policy.test.ts` covers the evaluator. No GPL, LGPL, AGPL, MPL, SSPL, EUPL, CC-BY-SA, or "no license" packages may be shipped. The build fails if one appears. Development-only tools may use other licenses because they are not distributed, but prefer permissive ones.
- The codebase contains no vendored third-party source. If code is ever copied from elsewhere, record its origin and license in `THIRD-PARTY-NOTICES.txt` generation or do not copy it.

## Documentation maintenance

- `README.md`: update when behavior, commands, build steps, limits, or licensing change. Add to it; do not trim or condense existing sections.
- `VALIDATION.md`: append dated verification records rather than rewriting earlier ones.
- This is a Node.js project. `package.json` and `package-lock.json` are the dependency manifest; there is no `requirements.txt` and none should be created.
- Update this file whenever the commands, layout, invariants, or policies above change.
