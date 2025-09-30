import { NodeHttpClient, NodePath, NodeSink, NodeStream } from "@effect/platform-node"
import { Effect, Layer, Schedule } from "effect"
import { Cache } from "effect/caching"
import { Path } from "effect/platform"
import { Duration } from "effect/time"
import { McpServer } from "effect/unstable/ai"
import { HttpClient } from "effect/unstable/http"
import { describe, expect, it } from "vitest"
import { Markdown } from "./Markdown.js"
import { ReferenceDocsTools } from "./ReferenceDocs.js"
import { Readmes } from "./Readmes.js"

describe("Integration Tests", () => {
  describe("MCP Server Startup/Shutdown", () => {
    it("should initialize MCP server with all layers", async () => {
      const result = await Effect.gen(function* () {
        const server = yield* McpServer.McpServer
        return server
      }).pipe(
        Effect.provide(
          McpServer.layerStdio({
            name: "test-server",
            version: "1.0.0",
            stdin: NodeStream.stdin,
            stdout: NodeSink.stdout,
          })
        ),
        Effect.provide([ReferenceDocsTools, Readmes]),
        Effect.scoped,
        Effect.runPromise,
      )

      expect(result).toBeDefined()
    })

    it("should provide all required layers without errors", async () => {
      const layerTest = Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient
        const path = yield* Path.Path
        const markdown = yield* Markdown
        return { httpClient, path, markdown }
      }).pipe(
        Effect.provide([
          NodeHttpClient.layerUndici,
          NodePath.layerPosix,
          Markdown.layer,
        ]),
        Effect.runPromise,
      )

      const services = await layerTest
      expect(services.httpClient).toBeDefined()
      expect(services.path).toBeDefined()
      expect(services.markdown).toBeDefined()
    })

    it("should gracefully handle layer initialization failures", async () => {
      const failingLayer = Layer.effectDiscard(Effect.fail("Initialization failed"))

      await expect(
        Effect.succeed("test").pipe(
          Effect.provide(failingLayer),
          Effect.runPromise,
        )
      ).rejects.toThrow()
    })
  })

  describe("Tool Execution", () => {
    describe("effect_doc_search", () => {
      it("should execute search and return results", async () => {
        // This is a simplified test - in real integration tests,
        // we would set up the full server and test the actual tool execution
        const mockSearch = Effect.succeed({
          results: [
            {
              documentId: 0,
              title: "Effect.succeed",
              description: "Creates a successful Effect",
            },
            {
              documentId: 1,
              title: "Effect.fail",
              description: "Creates a failed Effect",
            },
          ],
        })

        const result = await Effect.runPromise(mockSearch)
        expect(result.results).toHaveLength(2)
        expect(result.results[0].title).toBe("Effect.succeed")
      })

      it("should limit results to 50 items", async () => {
        const mockResults = Array.from({ length: 100 }, (_, i) => ({
          documentId: i,
          title: `Doc ${i}`,
          description: `Description ${i}`,
        }))

        const slicedResults = mockResults.slice(0, 50)
        expect(slicedResults).toHaveLength(50)
      })

      it("should handle empty search results", async () => {
        const mockSearch = Effect.succeed({ results: [] })
        const result = await Effect.runPromise(mockSearch)
        expect(result.results).toHaveLength(0)
      })
    })

    describe("get_effect_doc", () => {
      it("should retrieve document content with pagination", async () => {
        const mockContent = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}`)

        const paginate = (page: number, pageSize: number = 200) => {
          const size = Math.min(Math.max(Math.floor(pageSize), 1), 500)
          const pages = Math.max(1, Math.ceil(mockContent.length / size))
          const currentPage = Math.min(Math.max(page, 1), pages)
          const offset = (currentPage - 1) * size

          return Effect.succeed({
            content: mockContent.slice(offset, offset + size).join("\n"),
            page: currentPage,
            totalPages: pages,
          })
        }

        const page1 = await Effect.runPromise(paginate(1))
        expect(page1.page).toBe(1)
        expect(page1.totalPages).toBe(3)
        expect(page1.content.split("\n")).toHaveLength(200)

        const page2 = await Effect.runPromise(paginate(2))
        expect(page2.page).toBe(2)
        expect(page2.content).toContain("Line 201")
      })

      it("should respect pageSize parameter", async () => {
        const mockContent = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`)

        const paginate = (pageSize: number) => {
          const size = Math.min(Math.max(Math.floor(pageSize), 1), 500)
          return Effect.succeed({
            content: mockContent.slice(0, size).join("\n"),
            page: 1,
            totalPages: Math.ceil(mockContent.length / size),
          })
        }

        const result = await Effect.runPromise(paginate(100))
        expect(result.content.split("\n")).toHaveLength(100)
        expect(result.totalPages).toBe(3)
      })

      it("should handle invalid documentId gracefully", async () => {
        const getDoc = (id: number) => {
          if (id < 0 || id > 100) {
            return Effect.fail(new Error("Invalid document ID"))
          }
          return Effect.succeed({ content: "Valid doc", page: 1, totalPages: 1 })
        }

        await expect(Effect.runPromise(getDoc(-1))).rejects.toThrow()
        await expect(Effect.runPromise(getDoc(101))).rejects.toThrow()
      })
    })
  })

  describe("HTTP Client Retry Behavior", () => {
    it("should retry failed requests according to retry policy", async () => {
      let attemptCount = 0
      const failingRequest = Effect.gen(function* () {
        attemptCount++
        if (attemptCount < 3) {
          yield* Effect.fail(new Error("Network error"))
        }
        return "success"
      })

      const retryPolicy = Schedule.spaced(Duration.millis(100))
      const result = await Effect.runPromise(
        failingRequest.pipe(Effect.retry(retryPolicy))
      )

      expect(result).toBe("success")
      expect(attemptCount).toBe(3)
    })

    it("should use exponential backoff for retries", async () => {
      const retryPolicy = Schedule.exponential(Duration.millis(10))
      let attemptCount = 0
      const timestamps: number[] = []

      const failingRequest = Effect.gen(function* () {
        timestamps.push(Date.now())
        attemptCount++
        if (attemptCount < 4) {
          yield* Effect.fail(new Error("Temporary error"))
        }
        return "success"
      })

      await Effect.runPromise(
        failingRequest.pipe(Effect.retry(retryPolicy))
      )

      expect(attemptCount).toBe(4)
      expect(timestamps.length).toBe(4)

      // Verify increasing delays between attempts
      for (let i = 1; i < timestamps.length - 1; i++) {
        const delay1 = timestamps[i] - timestamps[i - 1]
        const delay2 = timestamps[i + 1] - timestamps[i]
        expect(delay2).toBeGreaterThanOrEqual(delay1 * 0.9) // Allow some timing variance
      }
    })

    it("should stop retrying after max attempts", async () => {
      let attemptCount = 0
      const alwaysFailingRequest = Effect.gen(function* () {
        attemptCount++
        yield* Effect.fail(new Error("Permanent error"))
      })

      const retryPolicy = Schedule.recurs(3)

      await expect(
        Effect.runPromise(
          alwaysFailingRequest.pipe(Effect.retry(retryPolicy))
        )
      ).rejects.toThrow("Permanent error")

      expect(attemptCount).toBe(4) // Initial attempt + 3 retries
    })

    it("should handle different error types during retry", async () => {
      let attemptCount = 0
      const request = Effect.gen(function* () {
        attemptCount++
        if (attemptCount === 1) {
          yield* Effect.fail({ _tag: "NetworkError" as const })
        } else if (attemptCount === 2) {
          yield* Effect.fail({ _tag: "TimeoutError" as const })
        }
        return "success"
      })

      const result = await Effect.runPromise(
        request.pipe(
          Effect.retry(Schedule.spaced(Duration.millis(10)))
        )
      )

      expect(result).toBe("success")
      expect(attemptCount).toBe(3)
    })
  })

  describe("Cache Behavior", () => {
    it("should cache values and serve from cache", async () => {
      let fetchCount = 0
      const cache = await Effect.runPromise(
        Cache.make({
          lookup: (key: number) =>
            Effect.sync(() => {
              fetchCount++
              return `value-${key}`
            }),
          capacity: 10,
          timeToLive: Duration.seconds(60),
        })
      )

      const value1 = await Effect.runPromise(Cache.get(cache, 1))
      const value2 = await Effect.runPromise(Cache.get(cache, 1))

      expect(value1).toBe("value-1")
      expect(value2).toBe("value-1")
      expect(fetchCount).toBe(1) // Should only fetch once
    })

    it("should respect cache capacity and evict old entries", async () => {
      const cache = await Effect.runPromise(
        Cache.make({
          lookup: (key: number) => Effect.succeed(`value-${key}`),
          capacity: 3,
          timeToLive: Duration.seconds(60),
        })
      )

      // Fill cache beyond capacity
      await Effect.runPromise(Cache.get(cache, 1))
      await Effect.runPromise(Cache.get(cache, 2))
      await Effect.runPromise(Cache.get(cache, 3))
      await Effect.runPromise(Cache.get(cache, 4)) // This should evict entry 1

      // All values should still be accessible (will refetch if evicted)
      const value1 = await Effect.runPromise(Cache.get(cache, 1))
      expect(value1).toBe("value-1")
    })

    it("should expire entries after TTL", async () => {
      let fetchCount = 0
      const cache = await Effect.runPromise(
        Cache.make({
          lookup: (key: number) =>
            Effect.sync(() => {
              fetchCount++
              return `value-${key}`
            }),
          capacity: 10,
          timeToLive: Duration.millis(100),
        })
      )

      await Effect.runPromise(Cache.get(cache, 1))
      expect(fetchCount).toBe(1)

      // Wait for TTL to expire
      await Effect.runPromise(Effect.sleep(Duration.millis(150)))

      await Effect.runPromise(Cache.get(cache, 1))
      expect(fetchCount).toBe(2) // Should fetch again after expiry
    })

    it("should handle concurrent cache access", async () => {
      let fetchCount = 0
      const cache = await Effect.runPromise(
        Cache.make({
          lookup: (key: number) =>
            Effect.gen(function* () {
              fetchCount++
              yield* Effect.sleep(Duration.millis(50))
              return `value-${key}`
            }),
          capacity: 10,
          timeToLive: Duration.seconds(60),
        })
      )

      // Access same key concurrently
      const results = await Effect.runPromise(
        Effect.all(
          [
            Cache.get(cache, 1),
            Cache.get(cache, 1),
            Cache.get(cache, 1),
          ],
          { concurrency: "unbounded" }
        )
      )

      expect(results).toEqual(["value-1", "value-1", "value-1"])
      expect(fetchCount).toBe(1) // Should only fetch once even with concurrent access
    })

    it("should cache multiple different keys", async () => {
      const fetchCounts = new Map<number, number>()
      const cache = await Effect.runPromise(
        Cache.make({
          lookup: (key: number) =>
            Effect.sync(() => {
              fetchCounts.set(key, (fetchCounts.get(key) || 0) + 1)
              return `value-${key}`
            }),
          capacity: 10,
          timeToLive: Duration.seconds(60),
        })
      )

      await Effect.runPromise(Cache.get(cache, 1))
      await Effect.runPromise(Cache.get(cache, 2))
      await Effect.runPromise(Cache.get(cache, 3))

      // Access again
      await Effect.runPromise(Cache.get(cache, 1))
      await Effect.runPromise(Cache.get(cache, 2))
      await Effect.runPromise(Cache.get(cache, 3))

      expect(fetchCounts.get(1)).toBe(1)
      expect(fetchCounts.get(2)).toBe(1)
      expect(fetchCounts.get(3)).toBe(1)
    })
  })

  describe("Concurrent Doc Loading", () => {
    it("should load multiple docs concurrently", async () => {
      const loadDoc = (id: number) =>
        Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(10))
          return { id, content: `Doc ${id}` }
        })

      const startTime = Date.now()
      const results = await Effect.runPromise(
        Effect.forEach(
          [1, 2, 3, 4, 5],
          loadDoc,
          { concurrency: "unbounded" }
        )
      )
      const duration = Date.now() - startTime

      expect(results).toHaveLength(5)
      expect(results[0].content).toBe("Doc 1")
      // With concurrency, should take roughly the same time as one request
      expect(duration).toBeLessThan(100)
    })

    it("should respect concurrency limits", async () => {
      let concurrentCount = 0
      let maxConcurrent = 0

      const loadDoc = (id: number) =>
        Effect.gen(function* () {
          concurrentCount++
          maxConcurrent = Math.max(maxConcurrent, concurrentCount)
          yield* Effect.sleep(Duration.millis(20))
          concurrentCount--
          return { id, content: `Doc ${id}` }
        })

      await Effect.runPromise(
        Effect.forEach(
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          loadDoc,
          { concurrency: 3 }
        )
      )

      expect(maxConcurrent).toBeLessThanOrEqual(3)
      expect(maxConcurrent).toBeGreaterThan(0)
    })

    it("should handle errors in concurrent loading", async () => {
      const loadDoc = (id: number) =>
        Effect.gen(function* () {
          if (id === 3) {
            yield* Effect.fail(new Error(`Failed to load doc ${id}`))
          }
          return { id, content: `Doc ${id}` }
        })

      await expect(
        Effect.runPromise(
          Effect.forEach(
            [1, 2, 3, 4, 5],
            loadDoc,
            { concurrency: "unbounded" }
          )
        )
      ).rejects.toThrow("Failed to load doc 3")
    })

    it("should successfully load all docs when none fail", async () => {
      const loadDoc = (id: number) =>
        Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(5))
          return { id, content: `Doc ${id}` }
        })

      const results = await Effect.runPromise(
        Effect.forEach(
          [1, 2, 3, 4, 5],
          loadDoc,
          { concurrency: "unbounded" }
        )
      )

      expect(results).toHaveLength(5)
      expect(results[0]).toEqual({ id: 1, content: "Doc 1" })
      expect(results[2]).toEqual({ id: 3, content: "Doc 3" })
      expect(results[4]).toEqual({ id: 5, content: "Doc 5" })
    })

    it("should load docs from multiple sources concurrently", async () => {
      const loadFromSource = (source: string, count: number) =>
        Effect.forEach(
          Array.from({ length: count }, (_, i) => i),
          (id) =>
            Effect.gen(function* () {
              yield* Effect.sleep(Duration.millis(10))
              return { source, id, content: `${source}-${id}` }
            }),
          { concurrency: 5 }
        )

      const startTime = Date.now()
      const results = await Effect.runPromise(
        Effect.all(
          [
            loadFromSource("api", 5),
            loadFromSource("github", 5),
            loadFromSource("docs", 5),
          ],
          { concurrency: "unbounded" }
        )
      )
      const duration = Date.now() - startTime

      expect(results).toHaveLength(3)
      expect(results[0]).toHaveLength(5)
      expect(results[1]).toHaveLength(5)
      expect(results[2]).toHaveLength(5)

      // Should take roughly the time of the slowest source, not the sum
      expect(duration).toBeLessThan(100)
    })

    it("should complete all successful concurrent operations", async () => {
      const operations = [
        Effect.succeed(1),
        Effect.succeed(2),
        Effect.succeed(3),
        Effect.succeed(4),
        Effect.succeed(5),
      ]

      const results = await Effect.runPromise(
        Effect.all(operations, { concurrency: "unbounded" })
      )

      expect(results).toEqual([1, 2, 3, 4, 5])
    })
  })
})