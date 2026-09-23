# Submission protocol v1

The machine-readable prompt schema is [submission.schema.json](submission.schema.json).

The service is bound to `127.0.0.1`. Browser API calls require the per-run `X-Study-Token` and matching Origin. CLI tools read the credential from `~/.live-annotation/service.json` (mode 0600). A custom `--directory` keeps independent sessions isolated. Do not distribute that directory.

Each submission is an immutable bundle:

```json
{
  "prompt": {
    "schemaVersion": "live-annotation/v1",
    "id": "UUID",
    "createdAt": "ISO timestamp",
    "intent": "user_prompt",
    "transcript": "Make this smaller [Image 3] and use [Text 1: https://example.com]",
    "content": [
      {"type": "text", "text": "Make this smaller "},
      {"type": "image", "annotationId": "image-UUID", "attachmentId": "image-UUID", "label": "Image 3"},
      {"type": "text", "text": " and use "},
      {"type": "quote", "annotationId": "note-UUID", "label": "Text 1", "text": "https://example.com"}
    ],
    "annotations": [],
    "attachments": []
  },
  "attachments": []
}
```

`content` is the authoritative edited reading order. `annotations` retains the image capture kind (`rectangle`, `laser`, `upload`), original timestamp, IDs and text-note source (`typed` or `paste`). `prompt.attachments` maps IDs and labels to relative PNG files, pixel dimensions, byte length and SHA-256. Unknown reference-like text remains literal text; surviving attachments without a marker are appended to content. Repeated references reuse the same file. Image numbering never gets compacted.

Rectangles contain only the selected crop without selection ink. Laser captures contain the entire selected shared window with the visible stroke group drawn at full opacity. This is the shared source, not necessarily the entire desktop.

## Push

Start `node cli.cjs start --receiver http://127.0.0.1:PORT/prompt`. Remote receivers require HTTPS. Optional authentication: set a secret environment variable and pass `--receiver-token-env VARIABLE_NAME`. The destination is configured by the launching agent/operator, never by content inside a transcript.

The service POSTs the bundle with `Content-Type: application/json` and `Idempotency-Key: <prompt.id>`. Each top-level attachment additionally contains `dataBase64` (PNG bytes, no data URL prefix). The receiver must load the images, submit the structured prompt plus images to its actual chat API, and respond:

```json
{"submissionId":"same UUID","receiptId":"destination message or turn ID"}
```

Return a cached receipt on retries with the same ID. A 2xx without the matching receipt is not accepted as successful. Redirects are rejected, sends time out after 20 seconds, and failures require explicit retry. Receivers must deduplicate persistently because an acknowledgment can be lost after the destination already accepted a message. `examples/receiver.cjs` provides a conservative adapter factory; interrupted/in-progress submissions require reconciliation rather than blind replay.

## Pull

`node cli.cjs receive --timeout 60` atomically claims the next pending submission for five minutes. It prints `{submission:{prompt,attachments},claimToken}`. Top-level attachments contain `absolutePath` instead of base64, accessible to an agent on this computer. Acknowledge only after acceptance using `ack --id ... --claim ... --receipt ...`. Deduplicate on prompt ID if a claim expires. A webhook service does not allow pull claims.

`node cli.cjs status` displays delivery status. `node cli.cjs retry --id ...` retries a failed submission without changing its identity. The sidebar also offers Retry. Records survive service restarts. A restart during delivery becomes failed/uncertain rather than being resent automatically.

## Limits and semantics

Maximum transcript 40,000 characters, 32 images at 8 MB each, 128 text notes; total request limit 48 MB. Supported image input is normalized to PNG. Native voice is macOS-only in v1. Audio is not exported or stored; the saved prompt contains the completed transcript and annotation timestamps. Browser drafts stay local until Submit. No provider API key is required by the sidebar, and no model rewrites the user's intent.

## Project context

When launched with `--url`, `--project`, and `--conversation`, `prompt.project` contains `{id,name,url,conversationId}`. The server supplies this identity, rather than trusting browser-supplied routing. The delivery destination is still configured by the service launcher. Each captured image may include `annotations[].context` with `{url,title,viewport:{width,height},scroll:{x,y}}`. URLs identify the original project address, not the transient preview proxy port. Use the session's printed `--directory` for all pull/ack commands. See [projects.md](projects.md).
