# Live Annotation Voice Mode

A standalone sidebar for speaking a prompt while marking screenshots and adding typed or pasted notes. It retains the waveform, expanded editor, screenshot animations, rectangle tool, and laser pen in a minimal, standalone interface.

## Get the project

```sh
git clone https://github.com/Bruce699/live-annotation-voice-mode.git
cd live-annotation-voice-mode
```

## Run locally

Requires Node.js 20+. On macOS install Xcode Command Line Tools (`xcode-select --install`) for the native dictation helper. The first run compiles the helper locally.

```sh
node cli.cjs start --delivery queue
```

These standalone terminal examples explicitly use manual queue mode. For automatic chat delivery, use the Codex desktop command or a receiver below.

Open **http://localhost:47832/**. Use Chrome for screen sharing. Click **Share a window**, choose the source, and draw on the live preview. The **+** button also accepts screenshots. Start the microphone to dictate; typing/pasting then pressing Enter creates a note while recording continues. Finish creates an editable transcript. Submit saves a structured prompt and sends it immediately when Codex desktop or a receiver is connected.

## Use with your local project

Start your website's normal development server, then pass its actual local URL:

```sh
node cli.cjs start --delivery queue --url http://localhost:3000/ --project "My website" --conversation "my-task-id"
```

Open the printed workspace link. Your interactive website appears beside the minimal sidebar. Browse, scroll, or use the box/laser tools while dictating. Captures keep their source page URL and viewport. Each project/conversation gets separate drafts and submissions. Pass the printed data directory to receiver commands with `--directory`. If 47832 is occupied, add `--port 47834` (or another free port).

The agent skill includes this launch workflow in [projects.md](references/projects.md). It reads the project's actual startup URL rather than guessing. Project files are unchanged; a separate local preview proxy adds the annotation tools and forwards normal page requests and development WebSockets.

## Connect an agent

- **Codex desktop (automatic):** launch from the active task with `"$CODEX_MCP_NODE_PATH" cli.cjs start` and any project options. Submit immediately messages that task, with the structured prompt and labeled screenshot paths. The host-supplied runtime and installed app tools are required; no polling request is needed. Use `--thread ID` only to explicitly choose another task.
- **Skill:** copy this entire repository into a folder named `live-annotation` inside the agent's skills directory. `SKILL.md` teaches the agent to open the sidebar and receive submissions in its current conversation.
- **Push:** run `node cli.cjs start --receiver http://127.0.0.1:PORT/prompt`. Connect the receiver to your agent's actual chat API. `examples/receiver.cjs` exports a factory taking `submit({id, prompt, images})`; return the real destination receipt ID. See [the protocol](references/protocol.md).
- **Pull:** run `node cli.cjs receive --timeout 60`, then acknowledge acceptance with the printed claim token. No destination is impersonated or automatically selected.

The service tracks pending, sending, delivered, and failed submissions. Project mode keeps the surrounding header and footer hidden for a minimal workspace. A saved bundle is not reported as a delivered chat message. Failed submissions stay on disk for retry; duplicate IDs are preserved across timeouts.

## Output and privacy

Each submission saves `prompt.json`, `delivery.json`, and labeled `attachments/Image N.png` files under `~/.live-annotation/submissions/<UUID>/`. The JSON contains the original transcript, ordered text/image/quote blocks, and attachment metadata. Deleted image numbers remain gaps. Pasted URLs remain quotes; they are not fetched automatically.

Dictation is on-device through Apple's Speech framework, and prefers the Mac's built-in microphone. Screen sharing requires the normal browser/OS picker. No raw microphone audio is retained. A configured remote receiver gets the submitted transcript and screenshots; otherwise they stay local. Do not share the data directory, which includes private drafts and the service token.

## Development

No npm runtime dependencies. Run `npm test`. The exported frontend and voice sources are included, so the package runs outside the original repository.

## Current boundaries

Voice requires macOS. Screen sharing may be unavailable in embedded browsers; open the local link in Chrome or add screenshots with +. Local projects have an interactive embedded page; other apps use a shared-window preview. Local captures are DOM-rendered with html2canvas and may not reproduce video, WebGL, external frames, or every CSS effect. Use Share a window for those cases. The skill works with agents that can run local commands and inspect local images. Native chat embedding and automatic injection require a host-specific adapter; the generic transport is included.

The source is available on GitHub. A license for the original project code has not yet been selected; it remains `UNLICENSED`. The `private: true` setting prevents accidental npm publication. Bundled third-party code retains its own licenses in `HTML2CANVAS-LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`.

For a narrow browser panel beside a chat, use **http://localhost:47832/?view=sidebar**. This shows only the composer; add screenshots with +. Use the full view to select a shared screen and draw annotations. The local browser page is not a plugin injected into another site's DOM.
