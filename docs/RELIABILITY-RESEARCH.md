# Installation capture and delivery reliability

This report records the October 3, 2026 investigation into missing screenshots, captures becoming misaligned after zoom, and prompts failing to reach the current agent conversation. It is for maintainers reviewing the repairs and agents installing the package. The failures span rendering, asynchronous capture state, desktop connection setup, and hidden feedback. A working toolbar alone cannot establish that the integration works.

The findings below identify defects and reproducible failure mechanisms. They do not establish which mechanism affected the user's original project, because that project's failing browser session was not retained.

## Lessons from DialKit

DialKit's agent guide specifies a complete integration: inspect the framework and package manager, install the matching adapter, mount one root with its styles, bind controls to real values, and check the running interface/build. Its Copy action transfers instructions through the clipboard; the guide does not promise automatic messages into an arbitrary chat. The applicable lesson is to make the agent's setup contract explicit and verifiable. [Official agent guide](https://www.dialkit.dev/agent)

Its package ships built `dist` assets, builds before packing, and runs tests/type checks before publishing. Its vanilla root subscribes to a shared store and releases subscriptions, controls, and pointer state during destruction. Live Annotation needs equivalent packaged completeness and capture cleanup, plus a separately verified host delivery adapter. [Package configuration](https://github.com/joshpuckett/dialkit/blob/main/package.json), [root implementation](https://github.com/joshpuckett/dialkit/blob/main/src/vanilla/DialRoot.ts)

The resulting setup sequence is in [SKILL.md](../SKILL.md): install the actual Git package, resolve its CLI path, start the actual project URL, run doctor, connect the current task, verify a screenshot and zoom cycle, and retain both servers in persistent terminals. Manual queue mode must be explicit.

## Screenshot rendering and viewport lifetime

The previous bundled html2canvas 1.4.1 color parser supported RGB/HSL functions and threw for unknown color functions. In Chromium, rendering a page with `background: oklch(60% .2 40)` reproduced its unsupported-color exception. A rectangle could therefore appear while rendering failed before an image existed. The renderer reconstructs DOM content and only implements supported CSS; it is not a compositor screenshot. [Versioned color parser](https://github.com/niklasvh/html2canvas/blob/v1.4.1/src/css/types/color.ts), [rendering limitations](https://html2canvas.hertzen.com/documentation)

The replacement is the unmodified html2canvas-pro 2.5.0 distribution, bundled for local/offline loading. [The vendor manifest](../public/vendor-manifest.json) records its source, tarball integrity, file SHA256, and licenses; a test verifies the bundled file hash. Modern color rendering and CORS-enabled images now pass pixel checks. Inaccessible cross-origin content, video, WebGL, and unsupported effects still need Share a window. [Replacement documentation](https://yorickshan.github.io/html2canvas-pro/)

The [annotation runtime](../public/website-annotations.js) now snapshots pointer geometry, scroll, viewport dimensions, and raster scale. Changes to viewport geometry, nested scrolling, or SPA navigation cancel pending work; late results are discarded. Failed and timed-out renders release pending state. Browser tests cover these transitions and page scale from 100% to 150% and back. The CSS `zoom` property is a distinct limitation: the replacement renderer double-scales it, so capture now fails visibly with a Share a window remedy instead of producing misaligned pixels.

## Desktop delivery and setup

Local connection experiments reproduced a runtime-dependent desktop failure: launching the installed app tools as a child of an unrelated system Node process was rejected. Starting with `CODEX_MCP_NODE_PATH` worked; replacing the CLI process with that runtime using `process.execve` also worked in the tested environment. This is observed host behavior, not a portable contract for every agent host. The CLI now prefers the host runtime and gives an actionable command when process replacement is unavailable. Node added `process.execve` in 22.15.0/23.11.0, so the documented Node 20 minimum requires the direct host-runtime route for this case. [Node process API](https://nodejs.org/api/process.html#processexecvefile-args-env), [setup implementation](../lib/setup.cjs)

Doctor reads the destination without sending a prompt. Both project and standalone storage are scoped to the task/session, and an explicit Codex conversation must match its destination. Session locks prevent concurrent starts from replacing a running service's identity. A failed connection cannot silently become a queue. Missing native voice prerequisites are optional for screenshot/text work.

HTTP acceptance into the local queue is distinct from host acceptance of a chat prompt. The adapter must preserve the structured prompt and labeled attachment paths, validate the destination's acknowledgment, and retain the same submission identity across retries. An ambiguous send cannot be automatically repeated without risking duplicate work. [Delivery adapter and receipt handling](../lib/codex-desktop.cjs), [receiver protocol](../references/protocol.md)

## Frontend failure visibility

The audit found that existing capture and submit errors were written to `#chat-activity`, while sidebar CSS hid that element. Capture/delivery status and retry/share controls were also inside hidden markup. Delivery errors reaching only the Send tooltip could be overwritten on render. These defects turn actionable failures into the reported appearance of a drawn box without a screenshot or a message that never arrives.

The repaired UI distinguishes local queueing from delivery, exposes failures and recovery controls, and preserves older failed deliveries when a newer submission succeeds. The screenshot store recovers from failed opens and aborted writes. Missing images or a missing chat bridge produce visible errors and retain the draft. Navigation during image persistence cannot resurrect a canceled capture. [Screenshot store](../public/capture-store.js), [host coordination](../public/host.js), [composer bridge](../public/sidebar-host.js)

## Verification results

Version 0.3.1 passed **38 unit/server/setup/adapter tests and 13 Chromium browser tests** together using `npm test` and `npm run test:browser`.

| Area | Verified result |
| --- | --- |
| Distribution | The 52-file version 0.3.1 tarball installed into a clean temporary consumer. Its CLI doctor verified the actual current Codex task using the host runtime. Earlier installed asset checks returned HTTP 200. |
| Installed CLI | A final browser smoke test launched the npm-installed CLI, rendered a project using modern CSS, captured a 330 × 180 PNG, and showed Delivered to agent after sending to an isolated local receiver. The receiver accepted one submission with `live-annotation/v1` text/image/text order and matching PNG hash. No browser errors occurred. The native microphone helper compiled; recording was not exercised. |
| Project and session setup | HTML/redirect validation, missing capabilities, explicit queue selection, task-scoped storage, session locks, and recovery from a dead lock owner pass automated checks. |
| Desktop connection | Read-only task lookup succeeded with the host runtime and process replacement. Adapter tests validate the destination, structured envelope, receipts, safe pre-send retries, and duplicate protection. |
| Capture pixels | Sampled modern-color and CORS image pixels, object-fit cropping, crop dimensions at DPR 1 and 2, responsive reflow, scroll, density changes, and browser page scale 100% → 150% → 100% pass Chromium checks. |
| Capture lifecycle | Resize, nested scroll, and SPA navigation invalidate pending results. Synchronous failures and a 20-second render timeout settle once and allow recovery. CSS zoom shows the explicit screen-sharing remedy. |
| Full receiver flow | A real browser capture survives reload and reaches a controlled HTTP receiver with ordered JSON and matching PNG bytes. Failed delivery remains visible after reload and newer success; retry retains the original ID. |
| Storage recovery | Missing images or a missing chat bridge retain draft errors. Navigation during persistence rejects stale images. IndexedDB open failures and aborted writes recover without leaving capture pending. |

Real chat submission remains untested: no real chat messages were sent during this investigation. On the user's first Submit, the destination must acknowledge acceptance and the receiving agent must inspect the labeled images. A receipt establishes acceptance, not completion of the requested work.

No package can obtain arbitrary ChatGPT website or desktop access merely by being installed. Automatic delivery requires the installed Codex host tools or a receiver implemented against the actual host API. Browser/OS screen and microphone permission pickers still require the user's interaction. These boundaries belong in the setup result whenever they apply.
