# Bun Docs MCP Server

This MCP server exposes tools and resources for searching and reading the Bun documentation (implemented with Effect runtime and layering).

What you get:

- Tools
  - `bun_docs_search({ query }) -> { results: { documentId, title, description? }[] }`
  - `get_bun_doc({ documentId, page?, pageSize? }) -> { content, page, totalPages }`
    - `pageSize` defaults to 200 and is capped at 500.
- Resources
  - `bun://doc/installation`
  - `bun://doc/quickstart`
  - `bun://doc/bundler`
  - `bun://doc/runtime/bun-apis`

How it works:

- Crawls `https://bun.com/sitemap.xml` and fetches markdown from `https://bun.com/docs/<slug>.md`.
- Parses titles/descriptions via a small Markdown processor.
- Builds an in-memory MiniSearch index and serves paginated content slices.

## Usage

Run with Docker:

```bash
docker run --rm -i timsmart/effect-mcp2
```

Or use npx:

```bash
npx -y effect-mcp2@latest
```

## Cursor

Add to your Cursor `mcp.json`:

```json
"bun-docs": {
  "command": "npx",
  "args": ["-y", "effect-mcp2@latest"]
}
```

## Claude Code

Register with Claude Code:

```bash
claude mcp add-json bun-docs '{
  "command": "npx",
  "args": [
    "-y",
    "effect-mcp2@latest"
  ],
  "env": {}
}' -s user
```

## Development

- Build: `pnpm build`
- Test: `pnpm test` (see `src/*.test.ts`)
- Dev (watch): `pnpm dev`

## Notes

- This server uses Effect for layering, logging, HTTP client, and caching.
- Prefer using the `bun_docs_search` tool for discovery; then fetch content with `get_bun_doc` using the returned `documentId` and optional pagination.
