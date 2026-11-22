---
name: excalidraw
description: Excalidraw diagrams as a live canvas shared with the user. Use when the user refers to a diagram or canvas they drew, asks to draw or change one, names a .excalidraw file, or wants Mermaid turned into a canvas diagram or back.
---

# Excalidraw

The user and you share a **live canvas**: one `.excalidraw` file that they may have open and be changing right now, so whatever you read earlier is already old. Their layout is theirs: change what the request needs and leave every other position, style and id as it is. What the diagram says comes from its source or from the user: solve a layout problem with position and `route`, keeping the same nodes and edges.

`$SKILL` below is the directory holding this file. Set it in each command that uses it. The scripts need only Node.

**Inside Orca** (`$ORCA_WORKSPACE_ID` is set), read [ORCA.md](ORCA.md) first: it adds how to see what the user sees and how to show them a diagram.

## Find

Use the file the user named. Otherwise list `*.excalidraw` and `*.excalidraw.json` in the workspace, newest first, and ask only if the choice is still unclear.

## Read

```bash
node "$SKILL/scripts/read.mjs" "$FILE"
```

This is the canvas structure with ids, in place of kilobytes of JSON. `UNBOUND` means an arrow only looks connected: judge it from the image, and say so when the meaning depends on it. `BROKEN` is fixed by the `relink` op; `LAYOUT` names a drawing mistake.

## Look

Structure misses what is drawn: freehand, grouping by proximity, colour, images. Render into the temp directory, then read the PNG:

```bash
PNG="$(mktemp -d)/canvas.png"
node "$SKILL/scripts/convert.mjs" render "$FILE" "$PNG"
```

This uses the network on first run and an installed Chrome, Chromium, Edge or Firefox.

## Change

Every write goes through `edit.mjs`, which works on the file as it is at that moment and maintains labels, links and arrow geometry. Run `node "$SKILL/scripts/edit.mjs" --help` for the operations, then pass them as one batch:

```bash
node "$SKILL/scripts/edit.mjs" "$FILE" <<'JSON'
[
  {"op":"add","as":"db","type":"ellipse","x":400,"y":100,"text":"Database","backgroundColor":"#a5d8ff"},
  {"op":"connect","from":"ID_FROM_READ","to":"db","text":"reads"}
]
JSON
```

Add `--create` for a new file. On exit 4 the batch was written and the listed part was then replaced, usually by the user editing that element: Read, and send only what is still missing. If it is replaced twice, tell the user and wait.

A change is done when the script exits 0, every entry in `warnings` is fixed, and in a render of the whole diagram each arrow you wrote visibly points the way you meant, with readable text.

## Mermaid to canvas

```bash
node "$SKILL/scripts/convert.mjs" mermaid diagram.mmd new.excalidraw
```

The same holds when you draw it by hand for a better layout: every node and edge of the source appears once, and nothing else does. To apply changed Mermaid to an existing diagram, edit that diagram, which keeps the user's layout. Compare the result with the source: some shapes degrade (a cylinder becomes a rectangle) and types such as pie become a single image. Prettier means restyling and laying out through Change.

## Canvas to Mermaid

Write the Mermaid yourself from Read plus Look. Validate it by converting it into a temp file, and check that every labelled node and every arrow of the canvas is present. Tell the user what Mermaid cannot carry: positions, freehand, images, arrows whose ends you inferred.
