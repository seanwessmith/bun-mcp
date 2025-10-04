import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { Schema } from "effect/schema"
import Minisearch from "minisearch"

describe("BunDocs", () => {
  describe("makePreview", () => {
    const makePreview = (value: string) =>
      value.split("\n").reduce((acc, line) => {
        if (acc.length >= 400) return acc
        const trimmed = line.trim()
        if (trimmed.length === 0) return acc
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

  describe("SearchResult Schema", () => {
    const SearchResult = Schema.Struct({
      documentId: Schema.Number.annotate({
        description: "The unique identifier for the Bun documentation entry.",
      }),
      title: Schema.String,
      description: Schema.optional(Schema.String),
    })

    it("should validate SearchResult with description", async () => {
      const result = {
        documentId: 42,
        title: "Bun.build",
        description: "Bun's native bundler",
      }
      const validated = await Effect.runPromise(
        Schema.decodeUnknownEffect(SearchResult)(result)
      )
      expect(validated).toMatchObject(result)
    })

    it("should validate SearchResult without description", async () => {
      const result = { documentId: 42, title: "bun install" }
      const validated = await Effect.runPromise(
        Schema.decodeUnknownEffect(SearchResult)(result)
      )
      expect(validated).toMatchObject(result)
    })

    it("should fail with invalid documentId type", async () => {
      const result = { documentId: "not-a-number", title: "Bun.build" }
      await expect(
        Effect.runPromise(Schema.decodeUnknownEffect(SearchResult)(result))
      ).rejects.toThrow()
    })

    it("should fail with missing required fields", async () => {
      const result = { documentId: 42 }
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
        searchOptions: { boost: { title: 2 } },
      })
      docs.forEach((doc) => minisearch.add(doc))
      return minisearch
    }

    it("should find exact title matches", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Bun.build", preview: "Bun's bundler" },
        { id: 1, title: "bun install", preview: "Package manager install" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("build")
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(0)
    })

    it("should boost title matches over description matches", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Something else", description: "bundler", preview: "Other content" },
        { id: 1, title: "Bun bundler", description: "bundler docs", preview: "fast" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("bundler")
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(1)
    })

    it("should search across multiple fields", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Bun.test", description: "Create tests", preview: "Testing" },
        { id: 1, title: "Different", description: "No match", preview: "Nothing here" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("tests")
      expect(results.length).toBeGreaterThan(0)
      expect(results.some((r) => r.id === 0)).toBe(true)
    })

    it("should handle partial word matches", () => {
      const docs: TestDoc[] = [{ id: 0, title: "Bun.build", preview: "Bundler" }]
      const index = createSearchIndex(docs)
      const results = index.search("bun")
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(0)
    })

    it("should handle multiple documents with similar titles", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "bun run", preview: "Run a script" },
        { id: 1, title: "bun install", preview: "Install deps" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("bun")
      expect(results.length).toBeGreaterThan(0)
      const ids = results.map((r) => r.id)
      expect(ids).toContain(0)
      expect(ids).toContain(1)
    })

    it("should handle empty description and preview", () => {
      const docs: TestDoc[] = [{ id: 0, title: "Title only", preview: "" }]
      const index = createSearchIndex(docs)
      const results = index.search("Title")
      expect(results.length).toBeGreaterThan(0)
    })

    it("should prefer more relevant results", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "map", description: "The map function", preview: "map map map" },
        { id: 1, title: "filter", description: "Contains map", preview: "Filtering" },
        { id: 2, title: "reduce", description: "Reduce arrays", preview: "map mentioned once" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("map")
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(0)
    })

    it("should search with multiple terms", () => {
      const docs: TestDoc[] = [
        { id: 0, title: "Bun.build", description: "Bundles code", preview: "Bundler" },
        { id: 1, title: "Array.map", description: "Maps arrays", preview: "Array mapping" },
      ]
      const index = createSearchIndex(docs)
      const results = index.search("bun build")
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(0)
    })

    it("should handle empty search query", () => {
      const docs: TestDoc[] = [{ id: 0, title: "Bun.build", preview: "Bundler" }]
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
      expect(result.page).toBe(1)
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
  })
})
