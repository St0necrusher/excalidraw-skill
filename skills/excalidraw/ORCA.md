# The canvas inside Orca

The user draws in Orca's official Excalidraw plugin (`stablyai.orca-excalidraw`). Your writes appear in their open tab by themselves. Their changes reach the file through Settings → Editor → Auto Save Files (about a second) or Cmd+S.

If a command below says the plugin is missing, ask the user to install Excalidraw from Settings → Plugins, and use the render from SKILL.md meanwhile.

## Look

```bash
ABS_PNG="$(mktemp -d)/canvas.png"
orca plugin shot stablyai.orca-excalidraw --editor "$ABS_FILE" --out "$ABS_PNG"
```

This is what the user sees, at their pan and zoom, so it often cuts a diagram off. Use it when their view or unsaved drawing matters; judge a whole diagram from the render.

## Show

```bash
orca plugin open stablyai.orca-excalidraw --editor "$ABS_FILE"
```

Run this for a diagram you created or when the user asks: it switches what they are looking at. Keep diagrams inside the workspace, as a file outside it opens as a separate workspace.
