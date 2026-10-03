# Theme and composer changes

Version 0.3.2 adds automatic dark mode, restores a clear filled submit state, and leaves 24px above the expanded composer's collapse handle. The changes apply to the local workspace and its annotation controls. Existing capture and delivery behavior continues to determine when a draft can be sent.

## Automatic appearance

The interface follows the browser's `prefers-color-scheme` value. A dark preference selects the dark palette on initial load; changing the preference updates the open workspace immediately. There is no stored theme override or extra setup step. A browser preference override takes precedence over the operating system in the usual way.

Shared theme variables in [theme.css](../public/theme.css) provide the workspace, sidebar iframe, and screen-sharing preview with consistent colors. The sidebar loads these after its bundled styles so the old explicit light color scheme cannot win. CSS drives the update directly, including native control and scrollbar appearance through `color-scheme: light dark`.

| Surface or control | Light mode | Dark mode |
| --- | --- | --- |
| Workspace background | `#e9e9eb` | `#18191b` |
| Sidebar | `#f1f1f1` | `#1f2023` |
| Composer | `#ffffff` | `#292a2e` |
| Primary text | `#24242a` | `#f2f2f4` |
| Secondary text | `#65656f` | `#b1b1ba` |
| Ready submit button | `#080808` with white icon | `#f2f2f4` with `#18191b` icon |

The dark palette separates the canvas, sidebar, and raised composer with small changes in brightness. Quotes, links, screenshot shelf fades, remove controls, focus indicators, delivery errors, and voice waveform bars use the same palette. Orange rectangle and red laser markers retain their established meaning; note accents become lighter blue for dark surfaces.

The annotation stylesheet is also injected into proxied projects. Its theme rules are scoped to the annotation toolbar rather than the project's root or body. They do not recolor the website or its screenshot pixels. The workspace follows the browser preference; it does not inspect an arbitrary site's theme class or override that site's independent theme setting.

## Submit state

The bundled sidebar previously applied a neutral background to all composer buttons with a selector that overrode the ready submit style. The new rules explicitly distinguish enabled and disabled submit states and outrank that selector.

A nonempty typed draft enables the filled button. Whitespace alone keeps the button neutral. Attachment-only drafts and a recording that can be submitted also use the filled state. Capture work still in progress and voice startup or transcription still disable submission; color does not bypass these existing safeguards. Clearing or successfully submitting a draft returns the button to its empty state.

## Expanded input spacing

The collapse handle protrudes above the composer's form. Previously, expansion placed the form at the panel's top without accounting for that protrusion, which left the handle against or above the sidebar edge.

[expanded-composer.js](../public/expanded-composer.js) now calculates the form position using the handle's offset and the form's border. This puts the handle's visible top 24px below the sidebar viewport's top. Expansion preserves the panel's bottom inset and recalculates geometry on resize. The shared sidebar inset also overrides the older compact layout's conflicting top position.

## Verification

Version 0.3.2 passed all **38 unit, server, setup, and adapter tests** and all **17 Chromium browser tests**, including four new theme and composer tests. The new checks cover initial light and dark appearance, preference changes without losing the draft, readable text and submit icons, whitespace and filled drafts, and pending captures disabling submission until cancellation. They also measure the 24px handle inset through resizing, collapse and reopen, with normal and reduced motion.

Visual inspection confirmed the light and dark composer and expanded input, with no browser errors reported. The source review confirmed that injected toolbar styles are scoped to the toolbar. Existing capture and delivery tests passed with their controlled receiver; the appearance checks did not send a message to a real agent conversation.

Saved visual checks: [light composer](verification/composer-light.png), [dark composer](verification/composer-dark.png), [expanded light composer](verification/composer-expanded-light.png), and [expanded dark composer](verification/composer-expanded-dark.png).

From the repository, run:

```sh
npm test
npm run test:browser
npm pack --dry-run
```

For a visual check, open the workspace and switch the browser's emulated color preference or the system appearance while keeping a draft open. Type and clear a message, expand a long draft, resize the sidebar, and check that the handle remains 24px from the top. Inspect the screen-sharing controls and the project annotation toolbar in both appearances. These checks do not require sending a message to a real agent conversation.
