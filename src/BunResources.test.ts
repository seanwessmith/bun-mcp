import { describe, expect, it } from "vitest"
import { pages } from "./BunResources.js"

describe("BunResources", () => {
  describe("Resource URI generation", () => {
    it("should generate correct URIs for pages", () => {
      pages.forEach((page) => {
        const uri = `bun://doc/${page.slug}`
        expect(uri).toMatch(/^bun:\/\/doc\/.+$/)
      })
    })

    it("should have unique URIs", () => {
      const uris = pages.map((p) => `bun://doc/${p.slug}`)
      const unique = new Set(uris)
      expect(unique.size).toBe(uris.length)
    })
  })

  describe("Content metadata", () => {
    it("should have valid page metadata", () => {
      pages.forEach((page) => {
        expect(page.slug).toBeTruthy()
        expect(page.name).toBeTruthy()
        expect(page.title).toBeTruthy()
        expect(page.description).toBeTruthy()
        expect(page.url).toMatch(/^https?:\/\//)
      })
    })
  })

  describe("Collection size", () => {
    it("should include at least a few core pages", () => {
      expect(pages.length).toBeGreaterThanOrEqual(3)
    })
  })
})
