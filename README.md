# excalidraw-skill

An agent skill for Excalidraw diagrams as a live canvas: you draw by hand, your agents read the diagram and edit the same file without wrecking your layout.

## Install

```bash
npx skills add St0necrusher/excalidraw-skill        # this project
npx skills add St0necrusher/excalidraw-skill -g     # all your projects
npx skills update excalidraw                        # later, to update
```

Then ask your agent in plain words:

- "Draw how this service handles an order and open it."
- "Look at what I drew and add a step after the green box."
- "Turn `docs/flow.mmd` into a nicer diagram I can edit."
- "Save this diagram as Mermaid."

## What it does

- **Reads** a diagram as a short list of shapes, texts and links instead of raw JSON, and looks at a rendered image for the rest.
- **Edits** through a script that takes a list of operations. It keeps labels and arrows linked, keeps the bends you drew, leaves locked elements alone and never writes over a file that changed while it was working.
- **Checks** each write: reports overlaps, arrows that point backwards or run through shapes, and changes that the editor replaced.
- **Converts** Mermaid to an editable diagram with the official Excalidraw CLI. The agent writes the way back to Mermaid and validates it.

## Requirements

- Node.js. Tested with 22 on macOS.
- For rendering and Mermaid: Chrome, Chromium, Edge or Firefox, and network on first use, when `npx` fetches `@excalidraw/cli`.
- An editor for `.excalidraw` files that reloads them when they change on disk.

In [Orca](https://github.com/stablyai/orca), install the official Excalidraw plugin from Settings → Plugins and turn on Settings → Editor → Auto Save Files. The skill then also screenshots and opens your canvas.

## Limits

- `.excalidraw.png` and `.excalidraw.svg` are not edited.
- If you and an agent change the same element within the same second, your version wins and the agent is told to retry.
- The checks catch broken layouts, not ugly ones.
- Tried with Claude Code in Orca. Other agents and editors are untested.

## Development

```bash
node --test tests/excalidraw.test.mjs
```
