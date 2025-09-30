# effect mcp server

This MCP server adds tools and resources for accessing Effect documentation.

## Usage

You can run with docker using:

```bash
docker run --rm -i timsmart/effect-mcp2
```

Or use npx:

```bash
npx -y effect-mcp2@latest
```

## Cursor
To use this MCP server with Cursor, please add the following to your cursor `mcp.json`:

```json
"effect-docs": {
  "command": "npx",
  "args": ["-y", "effect-mcp2@latest"]
}
```

## Claude Code Integration

To use this MCP server with Claude Code, run the following command:

```bash
claude mcp add-json effect-docs '{
  "command": "npx",
  "args": [
    "-y",
    "effect-mcp2@latest"
  ],
  "env": {}
}' -s user
```
