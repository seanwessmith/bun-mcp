# Bun Documentation MCP Server

Search and read the official Bun documentation from MCP-compatible clients without leaving the agent workflow. The server crawls Bun's published documentation, builds an in-memory search index, and returns paginated or section-scoped Markdown.

**Status:** Active public package. The verified npm command is `bun-mcp2` (latest tested release: `0.1.5`).

## What it exposes

- `bun_docs_search` — find documentation by topic
- `get_bun_doc` — read one paginated document
- `get_bun_doc_pages` — read a page range in one call
- `get_bun_doc_section` — retrieve a named heading and its children
- Bun documentation resources for installation, quickstart, bundling, and runtime APIs

The implementation uses Effect for service composition, logging, caching, HTTP access, and the stdio MCP runtime.

## Install

Run directly from npm:

```bash
npx -y bun-mcp2@latest
```

The first run needs internet access to fetch the package and Bun documentation.

### Cursor

Add this entry to `mcp.json`:

```json
{
  "bun-docs": {
    "command": "npx",
    "args": ["-y", "bun-mcp2@latest"]
  }
}
```

### Claude Code

```bash
claude mcp add-json bun-docs '{
  "command": "npx",
  "args": ["-y", "bun-mcp2@latest"],
  "env": {}
}' -s user
```

## Example workflow

```text
1. bun_docs_search({ "query": "HTML imports" })
2. get_bun_doc_section({ "documentId": "...", "heading": "HTML imports" })
3. Use the returned Markdown and source path in the implementation decision.
```

Search is for discovery. Use page ranges when you need surrounding context and section retrieval when you already know the heading.

## How it works

1. Read `https://bun.com/sitemap.xml`.
2. Fetch Markdown from Bun's published documentation endpoints.
3. Parse titles and descriptions and build a MiniSearch index.
4. Serve bounded content slices over stdio so clients can control context size.

## Development

This repository pins pnpm `10.18.0` in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs formatting, type checking, tests, and the production build. To run the server in watch mode:

```bash
pnpm dev
```

## License

MIT
