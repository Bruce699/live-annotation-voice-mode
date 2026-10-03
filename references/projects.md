# Local project workflow

Use the current project's real development command and observed preview URL. The sidebar does not infer a URL from arbitrary open ports or launch shell commands from a web request.

1. Inspect the project's run instructions, package manager, and scripts. Reuse a healthy existing preview; otherwise start its dev server in a persistent terminal. Read the actual URL from startup output and verify it responds. Prefer the exact host and port printed by the dev server.
2. Resolve the installed CLI: `node_modules/live-annotation-sidebar/cli.cjs` for a project dependency, or `cli.cjs` inside this skill/repository. In Codex desktop, use `CODEX_MCP_NODE_PATH` when supplied. Run doctor with the same options you will use to start:

   ```sh
   "$CODEX_MCP_NODE_PATH" node_modules/live-annotation-sidebar/cli.cjs doctor --url http://localhost:3000/ --project "My project"
   "$CODEX_MCP_NODE_PATH" node_modules/live-annotation-sidebar/cli.cjs start --url http://localhost:3000/ --project "My project" --port 47832
   ```

   Replace the examples with the actual URL, name, and installed path. The active Codex task supplies conversation identity and automatic delivery. For another host, use its Node runtime, a retained `--conversation ID`, and a real `--receiver URL`. Use `--delivery queue` only for deliberate manual receiving. Doctor does not send a test prompt. A webhook being configured does not prove that its destination accepted a message.
3. Resolve failed required checks before opening the workspace. If the chosen port belongs to another session, choose another port; do not stop someone else's server. Voice prerequisites are optional for typed/screenshot work. If the desktop connection rejects the runtime, launch the CLI with the host-provided `CODEX_MCP_NODE_PATH`. Never guess a task from the most recently active conversation.
4. Open the printed **Live Annotation** URL in a browser panel. Use the full view for the interactive website; `?view=sidebar` hides the website. Integrated local captures do not require a screen-sharing picker. Dictation can require browser/OS permission.
5. Verify the actual interface before declaring setup complete: load the expected project, draw a rectangle over recognizable content, wait for its labeled thumbnail, and open the capture to check its content. Repeat after zooming in and returning to the original zoom, and after scrolling or resizing. Confirm the box/laser controls can be deselected to resume normal browsing. If browser automation is unavailable, state that browser verification remains pending. A healthy HTTP endpoint or a drawn outline alone is not a capture test.
6. Save the printed **Data directory** in the agent's working context. Pass that exact directory to `receive`, `ack`, `status`, and `retry` with `--directory`. Alternatively supply the identical `--url`, `--project`, and `--conversation` identifiers. Check `prompt.project.conversationId` before applying a prompt. Captures retain source page URL, title, viewport, and scroll position as reference metadata.
7. Leave both services running. Receive/push according to SKILL.md. On the first user submission, check the actual destination acknowledgment and read the ordered prompt plus every labeled attachment. Treat a receipt as host acceptance, not completed agent work. Do not send an unsolicited real chat message as a setup test.

The project uses a separate loopback-origin proxy. Project files are not rewritten. Relative assets, form/API requests, redirects, SPA routes, and development WebSockets are forwarded. The annotation overlay lives inside the page. Deselect its tool or press Escape to resume normal browsing. Navigation cancels unfinished captures while completed attachments and dictation remain available.

The proxy adjusts embedding/CSP headers only in its local response to load the annotation runtime. It does not forward the sidebar service credential. Service workers are disabled in the wrapped preview so cached pages cannot bypass injection. Apps tied to absolute origins, strict authentication cookies, or origin-specific callbacks may need their normal development configuration adjusted for the proxy, or screen sharing.

Captures use a bundled DOM renderer with modern CSS color support. They are not the browser compositor's exact pixels. Video, WebGL, inaccessible cross-origin frames/images, and unsupported CSS may be incomplete. Use **Share a window**, select the original app/window, and annotate there for those cases. **Back to project** returns to the interactive page. External URLs are rejected by the automatic wrapper; use screen sharing for them.
