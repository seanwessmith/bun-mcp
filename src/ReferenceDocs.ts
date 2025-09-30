import { NodeHttpClient, NodePath } from "@effect/platform-node"
import { Effect, Layer, pipe, Schedule } from "effect"
import { Cache } from "effect/caching"
import { Option } from "effect/data"
import { Path } from "effect/platform"
import { Schema } from "effect/schema"
import { Duration } from "effect/time"
import { AiTool, AiToolkit, McpServer } from "effect/unstable/ai"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import Minisearch from "minisearch"
import * as Prettier from "prettier"
import { Markdown } from "./Markdown.js"
import { guides, readmes } from "./Readmes.js"

const docUrls = [
  "https://raw.githubusercontent.com/tim-smart/effect-io-ai/refs/heads/main/json/_all.json",
]
const websiteContentUrl =
  "https://raw.githubusercontent.com/tim-smart/effect-io-ai/refs/heads/main/website/content.json"

const websiteUrl = (path: string) =>
  `https://raw.githubusercontent.com/effect-ts/website/refs/heads/main/${path}`

const documentId = Schema.Number.annotate({
  description: "The unique identifier for the Effect documentation entry.",
})

const SearchResult = Schema.Struct({
  documentId,
  title: Schema.String,
  description: Schema.optional(Schema.String),
}).annotate({
  description: "A search result from the Effect reference documentation.",
})

const toolkit = AiToolkit.make(
  AiTool.make("effect_doc_search", {
    description:
      "Searches the Effect documentation. Result content can be accessed with the `get_effect_doc` tool.",
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

  AiTool.make("get_effect_doc", {
    description:
      "Get the Effect documentation for a documentId. The content might be paginated. Use the `page` parameter to specify which page to retrieve.",
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
)

interface DocumentEntry {
  readonly id: number
  readonly title: string
  readonly description?: string
  readonly preview: string
  readonly content: Effect.Effect<string>
}

const ToolkitLayer = pipe(
  toolkit.toLayer(
    Effect.gen(function* () {
      const path_ = yield* Path.Path
      const client = yield* HttpClient.HttpClient
      const docsClient = client.pipe(
        HttpClient.filterStatusOk,
        HttpClient.retry(retryPolicy),
      )
      const markdown = yield* Markdown
      const docs: Array<DocumentEntry> = []
      const minisearch = new Minisearch<DocumentEntry>({
        fields: ["title", "description", "preview"],
        searchOptions: {
          boost: { title: 2 },
        },
      })
      const addDoc = (doc: Omit<DocumentEntry, "id">) => {
        const entry: DocumentEntry = {
          id: docs.length,
          title: doc.title,
          description: doc.description,
          preview: doc.preview,
          content: doc.content,
        }
        docs.push(entry)
        minisearch.add(entry)
      }

      const fallbackBody = (kind: string, name: string) =>
        `# ${name}

This ${kind} could not be loaded right now. Please try again later.`

      const makePreview = (value: string) =>
        value.split("\n").reduce((acc, line) => {
          if (acc.length >= 400) {
            return acc
          }
          const trimmed = line.trim()
          if (trimmed.length === 0) {
            return acc
          }
          const next = acc.length === 0 ? trimmed : `${acc} ${trimmed}`
          return next.slice(0, 400)
        }, "")

      const fetchText = (url: string, kind: string, name: string) =>
        client.get(url).pipe(
          Effect.flatMap((response) => response.text),
          Effect.catch((cause) =>
            Effect.logError("Failed to fetch documentation", {
              kind,
              name,
              url,
              cause,
            }).pipe(Effect.as(fallbackBody(kind, name))),
          ),
        )

      const addStaticDocs = (kind: "guide" | "readme") =>
        Effect.forEach(
          (kind === "guide" ? guides : readmes) as ReadonlyArray<any>,
          (entry: any) =>
            Effect.gen(function* () {
              const body = yield* fetchText(
                entry.url,
                kind,
                kind === "guide" ? entry.name : entry.package,
              )
              addDoc({
                title: entry.title,
                description: entry.description,
                preview: makePreview(body) || entry.description,
                content: Effect.succeed(body),
              })
            }),
          { discard: true },
        )

      yield* addStaticDocs("guide")
      yield* addStaticDocs("readme")

      // Website documentation
      yield* client.get(websiteContentUrl).pipe(
        Effect.flatMap(
          HttpClientResponse.schemaBodyJson(Schema.Array(Schema.String)),
        ),
        Effect.flatMap(
          Effect.forEach(
            (filePath) =>
              client.get(websiteUrl(filePath)).pipe(
                Effect.flatMap((_) => _.text),
                Effect.flatMap((md) => markdown.process(md)),
                Effect.map((file) => {
                  const dirname = path_.basename(path_.dirname(filePath))
                  const title =
                    dirname !== "docs"
                      ? `${dirname.replace("-", " ")} - ${file.title}`
                      : file.title
                  addDoc({
                    title,
                    description: file.description,
                    preview:
                      (makePreview(file.content) || file.description) ?? title,
                    content: Effect.succeed(file.content),
                  })
                }),
                Effect.catch((cause: unknown) =>
                  Effect.logError("Failed to fetch website doc", {
                    filePath,
                    cause,
                  }),
                ),
              ),
            { concurrency: 10, discard: true },
          ),
        ),
        Effect.catch((cause: unknown) =>
          Effect.logError("Failed to fetch website content index", { cause }),
        ),
        Effect.forkScoped,
      )

      // Reference documentation
      const loadDocs = (url: string) =>
        Effect.flatMap(
          docsClient.get(url),
          HttpClientResponse.schemaBodyJson(DocEntry.Array),
        ).pipe(
          Effect.catch((cause: unknown) =>
            Effect.logError("Failed to fetch reference docs", {
              url,
              cause,
            }).pipe(Effect.as([] as Array<DocEntry>)),
          ),
        )

      yield* Effect.forEach(docUrls, loadDocs, {
        concurrency: docUrls.length,
      }).pipe(
        Effect.flatMap((entries) =>
          Effect.forEach(entries.flat(), (entry: DocEntry) =>
            Effect.gen(function* () {
              const description =
                Option.getOrNull(entry.description) ?? undefined
              const preview =
                description ??
                `${entry.project} ${entry.moduleTitle} ${entry.name}`
              const content = yield* entry.asMarkdown.pipe(
                Effect.catch((cause: unknown) =>
                  Effect.logError("Failed to render reference doc", {
                    doc: entry.nameWithModule,
                    cause,
                  }).pipe(
                    Effect.as(
                      fallbackBody("reference doc", entry.nameWithModule),
                    ),
                  ),
                ),
              )

              addDoc({
                title: entry.nameWithModule,
                description: description ?? "",
                preview: preview ?? "",
                content: Effect.succeed(content),
              })
            }),
          ),
        ),
        Effect.forkScoped,
      )

      const search = (query: string) =>
        Effect.sync(() => {
          const results = minisearch.search(query).slice(0, 50)
          return results.map((result) => docs[result.id])
        })

      const cache = yield* Cache.make({
        lookup: (id: number) =>
          docs[id].content.pipe(
            Effect.map((content) => content.split("\n")),
          ),
        capacity: 512,
        timeToLive: "12 hours",
      })

      return toolkit.of({
        effect_doc_search: Effect.fnUntraced(function* ({ query }) {
          const results = yield* Effect.orDie(search(query))
          return {
            results: results.map((result) => ({
              documentId: result.id,
              title: result.title,
              description: result.description ?? result.preview,
            })),
          }
        }),
        get_effect_doc: Effect.fnUntraced(function* ({
          documentId,
          page = 1,
          pageSize,
        }) {
          const size = Math.min(Math.max(Math.floor(pageSize ?? 200), 1), 500)
          const lines = yield* Cache.get(cache, documentId)
          const pages = Math.max(1, Math.ceil(lines.length / size))
          const currentPage = Math.min(Math.max(page, 1), pages)
          const offset = (currentPage - 1) * size
          return {
            content: lines.slice(offset, offset + size).join("\n"),
            page: currentPage,
            totalPages: pages,
          }
        }),
      })
    }),
  ),
  Layer.provide([
    NodeHttpClient.layerUndici,
    NodePath.layerPosix,
    Markdown.layer,
  ]),
)

export const ReferenceDocsTools = McpServer.toolkit(toolkit).pipe(
  Layer.provide(ToolkitLayer),
)

// schema

class DocEntry extends Schema.Class<DocEntry>("DocEntry")({
  _tag: Schema.String,
  module: Schema.Struct({
    name: Schema.String,
  }),
  project: Schema.String,
  name: Schema.String,
  description: Schema.OptionFromOptional(Schema.String),
  deprecated: Schema.Boolean,
  examples: Schema.Array(Schema.String),
  since: Schema.String,
  category: Schema.OptionFromOptional(Schema.String),
  signature: Schema.OptionFromOptional(Schema.String),
  sourceUrl: Schema.String,
}) {
  static readonly Array = Schema.Array(this)
  static readonly decode = Schema.decodeUnknownEffect(this)
  static readonly decodeArray = Schema.decodeUnknownEffect(this.Array)

  get url() {
    const project =
      this.project === "effect"
        ? "effect/effect"
        : this.project.replace(/^@/g, "")
    return `https://effect-ts.github.io/${project}/${this.module.name}.html#${this.name.toLowerCase()}`
  }

  get moduleTitle() {
    return this.module.name.replace(/\.[^/.]+$/, "")
  }

  get nameWithModule() {
    return `${this.moduleTitle}.${this.name}`
  }

  get isSignature() {
    return Option.isSome(this.signature)
  }

  get searchTerm(): string {
    return `/${this.project}/${this.moduleTitle}.${this.name}.${this._tag}`
  }

  get asMarkdown(): Effect.Effect<string> {
    return Effect.gen(this, function* () {
      let description = Option.getOrElse(this.description, () => "")

      if (Option.isSome(this.signature)) {
        description +=
          "\n\n```ts\n" + (yield* prettify(this.signature.value)) + "\n```"
      }

      if (this.examples.length > 0) {
        description += "\n\n**Example**"
        for (const example of this.examples) {
          description += "\n\n```ts\n" + example + "\n```"
        }
      }

      return `# ${this.project}/${this.nameWithModule}

${description}`
    })
  }
}

// prettier

const prettify = (code: string) =>
  Effect.tryPromise(() =>
    Prettier.format(code, {
      parser: "typescript",
      semi: false,
    }),
  ).pipe(Effect.orElseSucceed(() => code))

// errors

const retryPolicy = Schedule.spaced(Duration.seconds(3))
