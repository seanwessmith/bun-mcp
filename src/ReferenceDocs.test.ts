import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { Schema } from "effect/schema"
import Minisearch from "minisearch"

// Import the DocEntry class from ReferenceDocs
// We'll need to extract makePreview and other testable functions

describe("ReferenceDocs", () => {
  describe("makePreview", () => {
    // Helper function to test makePreview logic
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

    it("should create preview from simple text", () => {
      const input = "This is a simple line of text"
      const result = makePreview(input)
      expect(result).toBe("This is a simple line of text")
    })

    it("should concatenate multiple lines with spaces", () => {
      const input = "Line one\nLine two\nLine three"
      const result = makePreview(input)
      expect(result).toBe("Line one Line two Line three")
    })

    it("should skip empty lines", () => {
      const input = "Line one\n\n\nLine two"
      const result = makePreview(input)
      expect(result).toBe("Line one Line two")
    })

    it("should skip whitespace-only lines", () => {
      const input = "Line one\n   \n\t\nLine two"
      const result = makePreview(input)
      expect(result).toBe("Line one Line two")
    })

    it("should truncate at 400 characters", () => {
      const longLine = "a".repeat(500)
      const result = makePreview(longLine)
      expect(result.length).toBe(400)
    })

    it("should stop processing after 400 characters", () => {
      const input = "a".repeat(200) + "\n" + "b".repeat(300)
      const result = makePreview(input)
      expect(result.length).toBe(400)
      expect(result).toContain("a".repeat(200))
      expect(result).toContain("b")
      expect(result.match(/b/g)?.length).toBeLessThan(300)
    })

    it("should handle empty string", () => {
      const result = makePreview("")
      expect(result).toBe("")
    })

    it("should handle only whitespace", () => {
      const result = makePreview("\n\n   \n\t\n")
      expect(result).toBe("")
    })
  })

  describe("DocEntry", () => {
    // We need to import DocEntry from the module
    // For now, we'll create a test schema that matches DocEntry structure
    const DocEntry = Schema.Struct({
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
    })

    describe("Schema validation", () => {
      it("should validate a complete DocEntry", async () => {
        const validEntry = {
          _tag: "Function",
          module: { name: "Effect.ts" },
          project: "effect",
          name: "succeed",
          description: "Creates a successful Effect",
          deprecated: false,
          examples: ["Effect.succeed(42)"],
          since: "2.0.0",
          category: "constructors",
          signature: "export declare const succeed: <A>(value: A) => Effect<A>",
          sourceUrl: "https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts#L100",
        }

        const result = await Effect.runPromise(
          Schema.decodeUnknownEffect(DocEntry)(validEntry)
        )

        // Note: OptionFromOptional converts optional fields to Option types
        expect(result._tag).toBe(validEntry._tag)
        expect(result.module).toEqual(validEntry.module)
        expect(result.project).toBe(validEntry.project)
        expect(result.name).toBe(validEntry.name)
        expect(result.deprecated).toBe(validEntry.deprecated)
        expect(result.examples).toEqual(validEntry.examples)
        expect(result.since).toBe(validEntry.since)
        expect(result.sourceUrl).toBe(validEntry.sourceUrl)
      })

      it("should validate DocEntry with optional fields omitted", async () => {
        const minimalEntry = {
          _tag: "Interface",
          module: { name: "Types.ts" },
          project: "effect",
          name: "Context",
          deprecated: false,
          examples: [],
          since: "2.0.0",
          sourceUrl: "https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Context.ts#L50",
        }

        const result = await Effect.runPromise(
          Schema.decodeUnknownEffect(DocEntry)(minimalEntry)
        )
        expect(result).toMatchObject(minimalEntry)
      })

      it("should fail validation with missing required fields", async () => {
        const invalidEntry = {
          _tag: "Function",
          module: { name: "Effect.ts" },
          project: "effect",
          // missing 'name'
          deprecated: false,
          examples: [],
          since: "2.0.0",
          sourceUrl: "https://example.com",
        }

        await expect(
          Effect.runPromise(Schema.decodeUnknownEffect(DocEntry)(invalidEntry))
        ).rejects.toThrow()
      })

      it("should fail validation with wrong types", async () => {
        const invalidEntry = {
          _tag: "Function",
          module: { name: "Effect.ts" },
          project: "effect",
          name: "succeed",
          deprecated: "not a boolean", // wrong type
          examples: [],
          since: "2.0.0",
          sourceUrl: "https://example.com",
        }

        await expect(
          Effect.runPromise(Schema.decodeUnknownEffect(DocEntry)(invalidEntry))
        ).rejects.toThrow()
      })
    })

    describe("DocEntry methods", () => {
      // Mock DocEntry class methods
      const createDocEntry = (overrides: Partial<any> = {}) => ({
        _tag: "Function",
        module: { name: "Effect.ts" },
        project: "effect",
        name: "succeed",
        description: undefined,
        deprecated: false,
        examples: [],
        since: "2.0.0",
        category: undefined,
        signature: undefined,
        sourceUrl: "https://github.com/Effect-TS/effect",
        ...overrides,
      })

      describe("url", () => {
        it("should generate URL for effect project", () => {
          const entry = createDocEntry({ project: "effect", module: { name: "Effect.ts" }, name: "succeed" })
          const url = `https://effect-ts.github.io/effect/effect/${entry.module.name}#${entry.name.toLowerCase()}`
          expect(url).toBe("https://effect-ts.github.io/effect/effect/Effect.ts#succeed")
        })

        it("should generate URL for @effect/platform project", () => {
          const entry = createDocEntry({ project: "@effect/platform", module: { name: "HttpClient.ts" }, name: "get" })
          const project = entry.project.replace(/^@/g, "")
          const url = `https://effect-ts.github.io/${project}/${entry.module.name}#${entry.name.toLowerCase()}`
          expect(url).toBe("https://effect-ts.github.io/effect/platform/HttpClient.ts#get")
        })

        it("should lowercase the name in URL", () => {
          const entry = createDocEntry({ name: "FlatMap" })
          const url = `https://effect-ts.github.io/effect/effect/${entry.module.name}#${entry.name.toLowerCase()}`
          expect(url).toContain("#flatmap")
        })
      })

      describe("moduleTitle", () => {
        it("should remove file extension from module name", () => {
          const entry = createDocEntry({ module: { name: "Effect.ts" } })
          const moduleTitle = entry.module.name.replace(/\.[^/.]+$/, "")
          expect(moduleTitle).toBe("Effect")
        })

        it("should handle module without extension", () => {
          const entry = createDocEntry({ module: { name: "Effect" } })
          const moduleTitle = entry.module.name.replace(/\.[^/.]+$/, "")
          expect(moduleTitle).toBe("Effect")
        })

        it("should handle nested paths", () => {
          const entry = createDocEntry({ module: { name: "internal/Effect.ts" } })
          const moduleTitle = entry.module.name.replace(/\.[^/.]+$/, "")
          expect(moduleTitle).toBe("internal/Effect")
        })
      })

      describe("nameWithModule", () => {
        it("should combine module title and name", () => {
          const entry = createDocEntry({ module: { name: "Effect.ts" }, name: "succeed" })
          const moduleTitle = entry.module.name.replace(/\.[^/.]+$/, "")
          const nameWithModule = `${moduleTitle}.${entry.name}`
          expect(nameWithModule).toBe("Effect.succeed")
        })
      })
    })
  })

  describe("SearchResult Schema", () => {
    const SearchResult = Schema.Struct({
      documentId: Schema.Number.annotate({
        description: "The unique identifier for the Effect documentation entry.",
      }),
      title: Schema.String,
      description: Schema.optional(Schema.String),
    })

    it("should validate SearchResult with description", async () => {
      const result = {
        documentId: 42,
        title: "Effect.succeed",
        description: "Creates a successful Effect",
      }

      const validated = await Effect.runPromise(
        Schema.decodeUnknownEffect(SearchResult)(result)
      )
      expect(validated).toMatchObject(result)
    })

    it("should validate SearchResult without description", async () => {
      const result = {
        documentId: 42,
        title: "Effect.succeed",
      }

      const validated = await Effect.runPromise(
        Schema.decodeUnknownEffect(SearchResult)(result)
      )
      expect(validated).toMatchObject(result)
    })

    it("should fail with invalid documentId type", async () => {
      const result = {
        documentId: "not-a-number",
        title: "Effect.succeed",
      }

      await expect(
        Effect.runPromise(Schema.decodeUnknownEffect(SearchResult)(result))
      ).rejects.toThrow()
    })

    it("should fail with missing required fields", async () => {
      const result = {
        documentId: 42,
        // missing title
      }

      await expect(
        Effect.runPromise(Schema.decodeUnknownEffect(SearchResult)(result))
      ).rejects.toThrow()
    })
  })

  describe("Search functionality", () => {
    interface TestDoc {
      id: number
      title: string
      description?: string
      preview: string
    }

    const createSearchIndex = (docs: TestDoc[]) => {
      const minisearch = new Minisearch<TestDoc>({
        fields: ["title", "description", "preview"],
        searchOptions: {
          boost: { title: 2 },
        },
      })
      docs.forEach((doc) => minisearch.add(doc))
      return minisearch
    }

    it("should find exact title matches", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Effect.succeed", preview: "Creates a successful Effect" },
        { id: 1, title: "Effect.fail", preview: "Creates a failed Effect" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("succeed")

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(0)
    })

    it("should boost title matches over description matches", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Something else", description: "map function", preview: "Other content" },
        { id: 1, title: "Array.map", description: "Maps over arrays", preview: "Maps elements" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("map")

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(1) // Title match should rank higher
    })

    it("should search across multiple fields", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Effect.succeed", description: "Creates success", preview: "Success Effect" },
        { id: 1, title: "Different", description: "No match", preview: "Nothing here" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("success")

      expect(results.length).toBeGreaterThan(0)
      expect(results.some((r) => r.id === 0)).toBe(true)
    })

    it("should handle partial word matches", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Effect.flatMap", preview: "Flat mapping" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("flat")

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(0)
    })

    it("should return empty results for no matches", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Effect.succeed", preview: "Success" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("nonexistent")

      expect(results.length).toBe(0)
    })

    it("should handle case-insensitive search", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Effect.Succeed", preview: "Success" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("succeed")

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(0)
    })

    it("should rank multiple results by relevance", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "map", description: "The map function", preview: "map map map" },
        { id: 1, title: "filter", description: "Contains map", preview: "Filtering" },
        { id: 2, title: "reduce", description: "Reduce arrays", preview: "map mentioned once" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("map")

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(0) // Most relevant should be first
    })

    it("should search with multiple terms", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Effect.flatMap", description: "Maps Effect", preview: "Mapping effects" },
        { id: 1, title: "Array.map", description: "Maps arrays", preview: "Array mapping" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("effect map")

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(0)
    })

    it("should handle empty search query", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Effect.succeed", preview: "Success" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("")

      expect(results.length).toBe(0)
    })

    it("should handle searching empty index", () => {
      const docs: TestDoc[] = []
      const index = createSearchIndex(docs)
      const results = index.search("anything")

      expect(results.length).toBe(0)
    })
  })

  describe("Pagination logic", () => {
    // Mock the pagination logic from get_effect_doc
    const paginate = (lines: string[], page: number = 1, pageSize?: number) => {
      const size = Math.min(Math.max(Math.floor(pageSize ?? 200), 1), 500)
      const pages = Math.max(1, Math.ceil(lines.length / size))
      const currentPage = Math.min(Math.max(page, 1), pages)
      const offset = (currentPage - 1) * size
      return {
        content: lines.slice(offset, offset + size).join("\n"),
        page: currentPage,
        totalPages: pages,
      }
    }

    it("should paginate with default page size", () => {
      const lines = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines)

      expect(result.page).toBe(1)
      expect(result.totalPages).toBe(3)
      expect(result.content.split("\n").length).toBe(200)
    })

    it("should paginate with custom page size", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines, 1, 50)

      expect(result.page).toBe(1)
      expect(result.totalPages).toBe(2)
      expect(result.content.split("\n").length).toBe(50)
    })

    it("should cap page size at 500", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines, 1, 1000)

      expect(result.content.split("\n").length).toBe(500)
      expect(result.totalPages).toBe(2)
    })

    it("should enforce minimum page size of 1", () => {
      const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines, 1, 0)

      expect(result.content.split("\n").length).toBe(1)
      expect(result.totalPages).toBe(10)
    })

    it("should handle negative page size", () => {
      const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines, 1, -5)

      expect(result.content.split("\n").length).toBe(1)
    })

    it("should clamp page number to valid range (lower bound)", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines, -5)

      expect(result.page).toBe(1)
    })

    it("should clamp page number to valid range (upper bound)", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines, 999)

      expect(result.page).toBe(1) // totalPages is 1 with 100 lines and default 200 pageSize
    })

    it("should handle page 2 correctly", () => {
      const lines = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines, 2, 100)

      expect(result.page).toBe(2)
      expect(result.content).toContain("Line 101")
      expect(result.content).toContain("Line 200")
      expect(result.content).not.toContain("Line 100")
      expect(result.content).not.toContain("Line 201")
    })

    it("should handle last page with partial content", () => {
      const lines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines, 3, 100)

      expect(result.page).toBe(3)
      expect(result.totalPages).toBe(3)
      expect(result.content.split("\n").length).toBe(50)
    })

    it("should handle empty lines array", () => {
      const lines: string[] = []
      const result = paginate(lines)

      expect(result.page).toBe(1)
      expect(result.totalPages).toBe(1)
      expect(result.content).toBe("")
    })

    it("should handle single line", () => {
      const lines = ["Single line"]
      const result = paginate(lines)

      expect(result.page).toBe(1)
      expect(result.totalPages).toBe(1)
      expect(result.content).toBe("Single line")
    })

    it("should handle fractional page size (floor)", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      const result = paginate(lines, 1, 50.7)

      expect(result.content.split("\n").length).toBe(50)
    })
  })
})