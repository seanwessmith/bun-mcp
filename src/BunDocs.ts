import { NodeHttpClient, NodePath } from "@effect/platform-node"
import { Effect, Layer, pipe, Schedule } from "effect"
import { Cache } from "effect/caching"
import { Path } from "effect/platform"
import { Schema } from "effect/schema"
import { Duration } from "effect/time"
import { AiTool, AiToolkit, McpServer } from "effect/unstable/ai"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import Minisearch from "minisearch"
import { Markdown } from "./Markdown.js"

const sitemapUrl = "https://bun.com/sitemap.xml"

const documentId = Schema.Number.annotate({
  description: "The unique identifier for the Bun documentation entry.",
})

const SearchResult = Schema.Struct({
  documentId,
  title: Schema.String,
  description: Schema.optional(Schema.String),
}).annotate({
  description: "A search result from the Bun documentation.",
})

const toolkit = AiToolkit.make(
  AiTool.make("bun_docs_search", {
    description:
      "Searches the Bun documentation. Result content can be accessed with the `get_bun_doc` tool.",
    parameters: {
      query: Schema.String.annotate({
        description: "The search query to look for in the documentation.",
      }),
    },
    success: Schema.Struct({
      results: Schema.Array(SearchResult),
    }),
  })
    .annotate(AiTool.Readonly, true)
    .annotate(AiTool.Destructive, false),

  AiTool.make("get_bun_doc", {
    description:
      "Get the Bun documentation for a documentId. The content might be paginated. Use the `page` parameter to specify which page to retrieve.",
    parameters: {
      documentId,
      page: Schema.optional(Schema.Number).annotate({
        description: "The page number to retrieve for the document content.",
      }),
      pageSize: Schema.optional(Schema.Number).annotate({
        description:
          "The number of lines per page. Defaults to 200 and caps at 500 to avoid oversized responses.",
      }),
    },
    success: Schema.Struct({
      content: Schema.String,
      page: Schema.Number,
      totalPages: Schema.Number,
    }),
  })
    .annotate(AiTool.Readonly, true)
    .annotate(AiTool.Destructive, false),

  AiTool.make("get_bun_doc_pages", {
    description:
      "Get multiple pages of a Bun doc in one call (inclusive range).",
    parameters: {
      documentId,
      startPage: Schema.Number.annotate({ description: "Start page (1-indexed)." }),
      endPage: Schema.optional(Schema.Number).annotate({ description: "End page (inclusive). Defaults to startPage." }),
      pageSize: Schema.optional(Schema.Number).annotate({
        description:
          "Lines per page. Defaults to 200 and caps at 500 to avoid oversized responses.",
      }),
    },
    success: Schema.Struct({
      content: Schema.String,
      startPage: Schema.Number,
      endPage: Schema.Number,
      totalPages: Schema.Number,
    }),
  })
    .annotate(AiTool.Readonly, true)
    .annotate(AiTool.Destructive, false),

  AiTool.make("get_bun_doc_section", {
    description:
      "Get a specific section of a Bun doc by heading text. Returns content and page bounds.",
    parameters: {
      documentId,
      heading: Schema.String.annotate({ description: "Heading text to locate (case-insensitive)." }),
      depth: Schema.optional(Schema.Number).annotate({ description: "Match only this heading depth (e.g., 2 for H2)." }),
      pageSize: Schema.optional(Schema.Number).annotate({
        description:
          "Lines per page for pageStart/pageEnd calculations. Defaults to 200 and caps at 500.",
      }),
    },
    success: Schema.Struct({
      content: Schema.String,
      fromLine: Schema.Number,
      toLine: Schema.Number,
      pageStart: Schema.Number,
      pageEnd: Schema.Number,
      totalPages: Schema.Number,
    }),
  })
    .annotate(AiTool.Readonly, true)
    .annotate(AiTool.Destructive, false),
)

interface DocumentEntry {
  readonly id: number
  readonly title: string
  readonly description?: string
  readonly preview: string
  readonly content: Effect.Effect<string>
  readonly headings: ReadonlyArray<{ depth: number; text: string; line: number }>
}

const ToolkitLayer = pipe(
  toolkit.toLayer(
    Effect.gen(function* () {
      const path_ = yield* Path.Path
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
        HttpClient.retry(retryPolicy),
      )
      const markdown = yield* Markdown

      // in-memory doc store + index
      const docs: Array<DocumentEntry> = []
      const minisearch = new Minisearch<DocumentEntry>({
        fields: ["title", "description", "preview"],
        searchOptions: { boost: { title: 2 } },
      })
      const addDoc = (doc: Omit<DocumentEntry, "id">) => {
        const entry: DocumentEntry = {
          id: docs.length,
          title: doc.title,
          description: doc.description,
          preview: doc.preview,
          content: doc.content,
          headings: doc.headings,
        }
        docs.push(entry)
        minisearch.add(entry)
      }

      const makePreview = (value: string) =>
        value.split("\n").reduce((acc, line) => {
          if (acc.length >= 400) return acc
          const trimmed = line.trim()
          if (trimmed.length === 0) return acc
          const next = acc.length === 0 ? trimmed : `${acc} ${trimmed}`
          return next.slice(0, 400)
        }, "")

      const tryFetchText = (url: string) =>
        client.get(url).pipe(
          Effect.flatMap((response) => response.text),
        )

      // Load Bun docs from sitemap, fetch markdown when available
      const loadDocs = Effect.gen(function* () {
        const xml = yield* client.get(sitemapUrl).pipe(
          Effect.flatMap((r) => r.text),
          Effect.catch((cause) =>
            Effect.logError("Failed to fetch bun sitemap", { cause }).pipe(
              Effect.as(""),
            ),
          ),
        )

        const urls = Array.from(
          xml.matchAll(/<loc>([^<]+)<\/loc>/g),
          (m) => m[1],
        ).filter((u) => u.startsWith("https://bun.com/docs/"))

        // Fetch markdown content in parallel (bounded)
        yield* Effect.forEach(
          urls,
          (loc) =>
            Effect.gen(function* () {
              const mdUrl = `${loc}.md`
              const titleFromPath = path_.basename(loc)
              const raw = yield* tryFetchText(mdUrl).pipe(
                Effect.catch(() => Effect.succeed<string | null>(null)),
              )

              if (raw != null) {
                // Parse markdown for title/description
                const file = yield* markdown.process(raw)
                addDoc({
                  title: file.title || titleFromPath,
                  description: file.description,
                  preview: makePreview(file.content) || file.description || titleFromPath,
                  content: Effect.succeed(file.content),
                  headings: file.headings,
                })
              }
            }),
          { concurrency: 10, discard: true },
        )
      })

      // kick off background load
      yield* loadDocs.pipe(Effect.forkScoped)

      const search = (query: string) =>
        Effect.sync(() => {
          const results = minisearch.search(query).slice(0, 50)
          return results.map((result) => docs[result.id])
        })

      const cache = yield* Cache.make({
        lookup: (id: number) =>
          docs[id].content.pipe(Effect.map((content) => content.split("\n"))),
        capacity: 512,
        timeToLive: "12 hours",
      })

      const defaultPageSize = 200

      const clampPageSize = (pageSize?: number) =>
        Math.min(Math.max(Math.floor(pageSize ?? defaultPageSize), 1), 500)

      const findSectionRange = (
        hs: ReadonlyArray<{ depth: number; text: string; line: number }>,
        query: string,
        depth?: number,
      ) => {
        const norm = (s: string) => s.toLowerCase().replace(/[`*_~\[\]();:.,!?"'<>#]/g, "").trim()
        const q = norm(query)
        const filtered = depth ? hs.filter((h) => h.depth === depth) : hs
        const idx = filtered.findIndex((h) => norm(h.text).includes(q))
        if (idx < 0) return null
        const startLine = filtered[idx].line
        // end: next heading with depth <= current depth (within original array order)
        const origIdx = hs.findIndex((h) => h.line === filtered[idx].line)
        const thisDepth = filtered[idx].depth
        let endLine = Infinity
        for (let i = origIdx + 1; i < hs.length; i++) {
          if (hs[i].depth <= thisDepth) {
            endLine = hs[i].line - 1
            break
          }
        }
        return { startLine, endLine }
      }

      return toolkit.of({
        bun_docs_search: Effect.fnUntraced(function* ({ query }) {
          const start = Date.now()
          yield* Effect.annotateCurrentSpan({ tool: "bun_docs_search", query: query.slice(0, 200) })
          yield* Effect.logDebug("tool.start", { tool: "bun_docs_search", query: query.slice(0, 200) })

          const results = yield* Effect.orDie(search(query)).pipe(
            Effect.catch((cause) =>
              Effect.logError("tool.failure", {
                tool: "bun_docs_search",
                durationMs: Date.now() - start,
                cause,
              }).pipe(Effect.flatMap(() => Effect.fail(cause))),
            ),
          )

          const payload = {
            results: results.map((result) => ({
              documentId: result.id,
              title: result.title,
              description: result.description ?? result.preview,
            })),
          }

          yield* Effect.logInfo("tool.success", {
            tool: "bun_docs_search",
            durationMs: Date.now() - start,
            resultCount: results.length,
          })

          return payload
        }),

        get_bun_doc: Effect.fnUntraced(function* ({ documentId, page = 1, pageSize }) {
          const start = Date.now()
          const size = clampPageSize(pageSize)

          yield* Effect.annotateCurrentSpan({
            tool: "get_bun_doc",
            documentId,
            page,
            pageSize: size,
          })
          yield* Effect.logDebug("tool.start", {
            tool: "get_bun_doc",
            documentId,
            page,
            pageSize: size,
          })

          const lines = yield* Cache.get(cache, documentId).pipe(
            Effect.catch((cause) =>
              Effect.logError("tool.failure", {
                tool: "get_bun_doc",
                durationMs: Date.now() - start,
                documentId,
                cause,
              }).pipe(Effect.flatMap(() => Effect.fail(cause))),
            ),
          )

          const pages = Math.max(1, Math.ceil(lines.length / size))
          const currentPage = Math.min(Math.max(page, 1), pages)
          const offset = (currentPage - 1) * size

          const payload = {
            content: lines.slice(offset, offset + size).join("\n"),
            page: currentPage,
            totalPages: pages,
          }

          yield* Effect.logInfo("tool.success", {
            tool: "get_bun_doc",
            durationMs: Date.now() - start,
            documentId,
            page: currentPage,
            pageSize: size,
            totalPages: pages,
            contentLength: payload.content.length,
          })

          return payload
        }),

        get_bun_doc_pages: Effect.fnUntraced(function* ({ documentId, startPage, endPage, pageSize }) {
          const start = Date.now()
          const size = clampPageSize(pageSize)

          yield* Effect.annotateCurrentSpan({
            tool: "get_bun_doc_pages",
            documentId,
            startPage,
            endPage,
            pageSize: size,
          })
          yield* Effect.logDebug("tool.start", {
            tool: "get_bun_doc_pages",
            documentId,
            startPage,
            endPage,
            pageSize: size,
          })

          const lines = yield* Cache.get(cache, documentId)
          const pages = Math.max(1, Math.ceil(lines.length / size))
          const s = Math.min(Math.max(startPage, 1), pages)
          const e = Math.min(Math.max(endPage ?? startPage, s), pages)
          const startOffset = (s - 1) * size
          const endOffset = e * size

          const payload = {
            content: lines.slice(startOffset, endOffset).join("\n"),
            startPage: s,
            endPage: e,
            totalPages: pages,
          }

          yield* Effect.logInfo("tool.success", {
            tool: "get_bun_doc_pages",
            durationMs: Date.now() - start,
            documentId,
            startPage: s,
            endPage: e,
            pageSize: size,
            totalPages: pages,
            contentLength: payload.content.length,
          })

          return payload
        }),

        get_bun_doc_section: Effect.fnUntraced(function* ({ documentId, heading, depth, pageSize }) {
          const start = Date.now()
          const size = clampPageSize(pageSize)

          yield* Effect.annotateCurrentSpan({
            tool: "get_bun_doc_section",
            documentId,
            heading: heading.slice(0, 200),
            depth: depth ?? null,
            pageSize: size,
          })
          yield* Effect.logDebug("tool.start", {
            tool: "get_bun_doc_section",
            documentId,
            heading: heading.slice(0, 200),
            depth: depth ?? null,
            pageSize: size,
          })

          const doc = docs[documentId]
          if (!doc) {
            return yield* Effect.fail(new Error("Document not found"))
          }

          const lines = yield* Cache.get(cache, documentId)
          const match = findSectionRange(doc.headings, heading, depth)
          if (match == null) {
            return yield* Effect.fail(new Error("Section not found"))
          }

          const from = Math.max(1, match.startLine)
          const to = Math.min(lines.length, match.endLine === Infinity ? lines.length : match.endLine)
          const content = lines.slice(from - 1, to).join("\n")
          const pages = Math.max(1, Math.ceil(lines.length / size))
          const pageStart = Math.min(Math.max(Math.ceil(from / size), 1), pages)
          const pageEnd = Math.min(Math.max(Math.ceil(to / size), pageStart), pages)

          const payload = {
            content,
            fromLine: from,
            toLine: to,
            pageStart,
            pageEnd,
            totalPages: pages,
          }

          yield* Effect.logInfo("tool.success", {
            tool: "get_bun_doc_section",
            durationMs: Date.now() - start,
            documentId,
            heading: heading.slice(0, 100),
            depth: depth ?? null,
            pageStart,
            pageEnd,
            totalPages: pages,
            contentLength: payload.content.length,
          })

          return payload
        }),
      })
    }),
  ),
  Layer.provide([NodeHttpClient.layerUndici, NodePath.layerPosix, Markdown.layer]),
)

export const BunDocsTools = McpServer.toolkit(toolkit).pipe(Layer.provide(ToolkitLayer))

const retryPolicy = Schedule.spaced(Duration.seconds(3))
