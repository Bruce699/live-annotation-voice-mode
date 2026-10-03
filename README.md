# Live Annotation Voice Mode

Speak, type, and mark screenshots beside your local website, then send the ordered prompt and labeled images to your current agent conversation. The package includes the sidebar, local preview proxy, screenshot renderer, and delivery adapters.

## Set up with one prompt

Ask your coding agent:

> Install Live Annotation from github:Bruce699/live-annotation-voice-mode into this project using its package manager. Read node_modules/live-annotation-sidebar/SKILL.md. Reuse or start this project's development server and use its actual URL. Connect the sidebar to this conversation, run the doctor checks, then launch it in a persistent terminal and open the printed workspace URL. Verify that a rectangle creates a screenshot thumbnail and stays aligned after zooming in and back out. Use the real chat adapter; report any missing host capability. Keep the service running for my submissions.

Requires Node.js 20+. Automatic delivery is supported by the **Codex desktop adapter** or a **receiver connected to your agent's real chat API**. Installing a package does not grant access to an arbitrary ChatGPT website or desktop conversation. The agent must establish a supported connection before calling setup complete.

The [agent skill](SKILL.md) is the executable setup guide. It follows the same pattern as [DialKit's agent guide](https://www.dialkit.dev/agent): inspect the actual project, install the correct package, connect the integration, and verify it in the running interface. DialKit's own Copy action uses the clipboard; automatic chat delivery here requires the additional host adapter.

## Install and connect

From your project's directory, use its existing package manager; the npm equivalent is:

```sh
npm install --save-dev github:Bruce699/live-annotation-voice-mode
```

The package name is `live-annotation-sidebar`; its command is `live-annotation`. For repeatable installations, pin the Git dependency to a reviewed commit or release. The source is installed from GitHub; this is not a published npm registry release.

Start your website's usual development server, then use its observed local URL. In a **Codex desktop agent terminal**, prefer the host runtime:

```sh
"$CODEX_MCP_NODE_PATH" node_modules/live-annotation-sidebar/cli.cjs doctor --url http://localhost:3000/ --project "My website"
"$CODEX_MCP_NODE_PATH" node_modules/live-annotation-sidebar/cli.cjs start --url http://localhost:3000/ --project "My website"
```

Replace the example URL and project name. The active Codex task supplies the conversation and delivery destination automatically. `--thread ID` explicitly selects another authorized task; an explicit `--conversation ID` must match that Codex destination. Open the printed **Live Annotation** URL and retain the printed **Data directory** for status and retry commands. Keep both development and annotation servers running. If the annotation port is occupied, add `--port 47834` or another free port.

`doctor` checks the installed assets, project response, and available delivery adapter without sending a chat message. It also reports voice prerequisites. It cannot prove browser rendering or a future message's acceptance: check screenshots in the browser and check the delivery receipt after an actual submission. `start` verifies the Codex destination before serving the workspace. If Codex refuses the runtime, use its `CODEX_MCP_NODE_PATH` command above.

For a different agent host, use a real receiver endpoint:

```sh
npx live-annotation doctor --url http://localhost:3000/ --project "My website" --conversation "my-task-id" --receiver http://127.0.0.1:PORT/prompt
npx live-annotation start --url http://localhost:3000/ --project "My website" --conversation "my-task-id" --receiver http://127.0.0.1:PORT/prompt
```

Replace `PORT`, the URL, and the identity with actual values. A configured receiver is not yet a verified chat delivery. [examples/receiver.cjs](examples/receiver.cjs) wraps your host's `submit({id, prompt, images})` function; it must return the real destination receipt ID. See [the protocol](references/protocol.md). Manual queue mode is available only by explicitly choosing `--delivery queue` and running the pull workflow below.

For a source checkout instead of a project dependency:

```sh
git clone https://github.com/Bruce699/live-annotation-voice-mode.git
cd live-annotation-voice-mode
node cli.cjs help
```

Run the same doctor/start commands with `cli.cjs` as the path. Copying the **entire repository** into an agent skill directory named `live-annotation` also includes everything the skill needs; copying only `SKILL.md` does not install the application.

## Use the workspace

Your interactive website appears beside the composer. Draw a rectangle or use the laser tool, speak, type, or paste notes. A completed capture must appear as a labeled thumbnail before you submit. Use **+** for existing screenshots. Start the microphone to dictate; typing or pasting and pressing Enter creates a note while recording continues. Finish creates an editable transcript. Submit saves the structured prompt and immediately attempts delivery through the selected adapter.

Each project/conversation has separate drafts and submissions. The local proxy adds the annotation tools and forwards page requests and development WebSockets. [Project setup and verification](references/projects.md) explains navigation, capture checks, and project-specific limitations.

For other apps, start without `--url`, open the full workspace in Chrome, and use **Share a window** to select the source. Browser/OS permission pickers require the user's interaction. For a composer-only browser panel, open the printed URL with `?view=sidebar`; add screenshots using **+**.

## Appearance and composer

The workspace automatically follows the browser's system color preference and updates when that preference changes, without a reload or saved theme override. Dark mode uses charcoal surfaces, light text, and quieter borders across the sidebar, expanded input, voice controls, screenshot shelf, and annotation toolbar. The embedded project's own colors remain under that project's control.

When the draft is ready to send, the submit button is filled black in light mode and light in dark mode. An empty draft remains neutral; pending captures and voice transitions still disable submission. The expanded input's collapse handle sits 24px below the top of the sidebar, including after resizing. See [the theme and composer change report](docs/THEME-AND-COMPOSER.md) for the design, implementation, and checks.

## Delivery and troubleshooting

The service tracks queued, delivering, delivered, and failed submissions. A saved bundle is not reported as a delivered message. Acknowledgment means the host accepted the prompt; it does not mean the agent finished the requested work. Failed or uncertain submissions remain on disk. Check the destination before retrying an uncertain delivery.

| Symptom | Check |
| --- | --- |
| Rectangle appears without an image | Wait for capture completion and inspect the visible capture error. Run doctor, reload the project preview, and try a small rectangle. For unsupported visual content, use Share a window. |
| Capture shifts after zoom or resizing | Finish or cancel the current gesture, let the viewport settle, then draw again. Verify at both zoom levels; do not submit an incorrectly positioned capture. |
| Prompt remains queued | Check the configured delivery mode. Queue mode requires a receiver claim and acknowledgment; it does not automatically send to chat. |
| Delivery failed | Read status and check the real destination. Repair the host connection before retrying; preserve the submission ID. |
| Voice is unavailable | On macOS, install Xcode Command Line Tools (`xcode-select --install`) and grant microphone/Speech permissions. Typed notes and screenshot capture remain usable. |

From the package or checkout directory:

```sh
node cli.cjs status --directory "PRINTED_DATA_DIRECTORY"
node cli.cjs retry --directory "PRINTED_DATA_DIRECTORY" --id "SUBMISSION_UUID"
```

For deliberate manual receiving, start with `--delivery queue`, run `node cli.cjs receive --directory "PRINTED_DATA_DIRECTORY" --timeout 60`, inspect the returned prompt and attachments, then acknowledge with the printed claim token. Follow [SKILL.md](SKILL.md) for the complete claim/ack workflow.

## Output and platform limits

Submissions contain `prompt.json`, `delivery.json`, and labeled `attachments/Image N.png` files inside the printed data directory. The JSON preserves the original transcript, ordered text/image/quote blocks, and attachment metadata. Deleted image numbers remain gaps. Pasted URLs remain quotes and are not fetched automatically.

Dictation uses Apple's on-device Speech framework on macOS and prefers the Mac's built-in microphone. The helper compiles locally on first use/setup; no speech API key or retained raw microphone recording is required. A configured receiver receives submitted text and screenshots. The data directory contains private drafts and a service token; do not publish it.

Local captures use a bundled DOM renderer with modern CSS color support. They may still omit video, WebGL, inaccessible cross-origin frames/images, or unsupported CSS effects. Pages using the CSS `zoom` property show an explicit capture error; use Chrome's **Share a window** for accurate captures in those cases. Browser page zoom is covered separately by the regression tests. Screen sharing may be unavailable in embedded browsers. Native chat embedding and automatic injection require a host-specific adapter; the sidebar does not inject into arbitrary chat websites.

## Development

No npm runtime dependencies. For development, install the package's dev dependencies and Playwright's Chromium (`npx playwright install chromium`), then run `npm test` and `npm run test:browser`. Version 0.3.2 passed **38 unit/server/setup/adapter tests and 17 Chromium browser tests**. Four browser tests cover automatic theme changes, submit states, the 24px collapse handle inset, and pending capture behavior. The existing tests cover capture pixels, browser zoom, reload/persistence, recovery, and ordered submission with matching PNG bytes through a controlled receiver. Appearance checks sent no real chat message. See [the theme report](docs/THEME-AND-COMPOSER.md) for visual evidence.

The frontend, screenshot renderer, and voice sources are included in the package. A clean installation of the 52-file version 0.3.1 tarball passed doctor against the current Codex task using the host runtime, then completed browser capture and verified delivery to an isolated test receiver through the installed CLI. Use `npm pack --dry-run` to inspect distribution contents.

See [the reliability investigation](docs/RELIABILITY-RESEARCH.md) for the DialKit setup research, capture/delivery failure mechanisms, and verification boundaries.

A license for the original project code has not yet been selected; it remains `UNLICENSED`. `private: true` prevents accidental npm publication while permitting Git/local installation. Bundled third-party code retains its licenses in `HTML2CANVAS-PRO-LICENSE.txt`, `HTML2CANVAS-LICENSE.txt`, and `THIRD_PARTY_NOTICES.txt`.
