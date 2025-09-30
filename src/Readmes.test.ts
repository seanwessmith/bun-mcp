import { describe, expect, it } from "vitest"
import { guides, readmes } from "./Readmes"

describe("Readmes", () => {
  describe("Resource URI generation", () => {
    it("should generate correct URIs for guides", () => {
      guides.forEach((guide) => {
        const uri = `effect://guide/${guide.name}`
        expect(uri).toMatch(/^effect:\/\/guide\/[\w-]+$/)
      })
    })

    it("should generate correct URIs for readmes", () => {
      readmes.forEach((readme) => {
        const uri = `effect://readme/${readme.package}`
        expect(uri).toMatch(/^effect:\/\/readme\/@effect\/[\w-]+$/)
      })
    })

    it("should have unique URIs", () => {
      const guideUris = guides.map((g) => `effect://guide/${g.name}`)
      const readmeUris = readmes.map((r) => `effect://readme/${r.package}`)
      const allUris = [...guideUris, ...readmeUris]
      const uniqueUris = new Set(allUris)
      expect(uniqueUris.size).toBe(allUris.length)
    })
  })

  describe("Content metadata", () => {
    it("should have valid guide metadata", () => {
      guides.forEach((guide) => {
        expect(guide.name).toBeTruthy()
        expect(guide.title).toBeTruthy()
        expect(guide.description).toBeTruthy()
        expect(guide.url).toMatch(/^https?:\/\//)
      })
    })

    it("should have valid readme metadata", () => {
      readmes.forEach((readme) => {
        expect(readme.package).toMatch(/^@effect\/[\w-]+$/)
        expect(readme.name).toBeTruthy()
        expect(readme.title).toBeTruthy()
        expect(readme.description).toBeTruthy()
        expect(readme.url).toMatch(/^https?:\/\//)
      })
    })
  })

  describe("Layer construction", () => {
    it("should have correct number of resources", () => {
      const expectedCount = guides.length + readmes.length
      expect(expectedCount).toBeGreaterThan(0)
      expect(guides.length).toBe(1)
      expect(readmes.length).toBe(4)
    })

    it("should have proper guide structure", () => {
      const guide = guides[0]
      expect(guide).toHaveProperty("name")
      expect(guide).toHaveProperty("title")
      expect(guide).toHaveProperty("description")
      expect(guide).toHaveProperty("url")
    })

    it("should have proper readme structure", () => {
      const readme = readmes[0]
      expect(readme).toHaveProperty("package")
      expect(readme).toHaveProperty("name")
      expect(readme).toHaveProperty("title")
      expect(readme).toHaveProperty("description")
      expect(readme).toHaveProperty("url")
    })
  })
})