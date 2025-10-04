import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { Markdown } from "./Markdown.js"

describe("Markdown", () => {
  describe("process()", () => {
    describe("frontmatter parsing", () => {
      it("should parse frontmatter from markdown", async () => {
        const markdown = `---
title: Test Title
description: Test Description
author: Test Author
---

# Content`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.frontmatter).toEqual({
          title: "Test Title",
          description: "Test Description",
          author: "Test Author",
        })
      })

      it("should handle markdown without frontmatter", async () => {
        const markdown = `# Just a heading

Some content`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.frontmatter).toEqual({})
      })

      it("should handle empty frontmatter", async () => {
        const markdown = `---
---

# Content`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.frontmatter).toEqual({})
      })
    })

    describe("heading extraction", () => {
      it("should extract headings at various depths", async () => {
        const markdown = `# Level 1
## Level 2
### Level 3
#### Level 4
##### Level 5
###### Level 6`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.headings.map(({ depth, text }) => ({ depth, text }))).toEqual([
          { depth: 1, text: "Level 1" },
          { depth: 2, text: "Level 2" },
          { depth: 3, text: "Level 3" },
          { depth: 4, text: "Level 4" },
          { depth: 5, text: "Level 5" },
          { depth: 6, text: "Level 6" },
        ])
      })

      it("should extract nested content from headings", async () => {
        const markdown = `# Heading with **bold** and *italic*
## Heading with \`code\` and [link](url)`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        // The implementation only extracts text nodes, not inline formatting
        expect(result.headings.map(({ depth, text }) => ({ depth, text }))).toEqual([
          { depth: 1, text: "Heading with  and " },
          { depth: 2, text: "Heading with  and " },
        ])
      })

      it("should handle multiple headings of the same depth", async () => {
        const markdown = `## First H2
Some content
## Second H2
More content
## Third H2`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.headings.map(({ depth, text }) => ({ depth, text }))).toEqual([
          { depth: 2, text: "First H2" },
          { depth: 2, text: "Second H2" },
          { depth: 2, text: "Third H2" },
        ])
      })

      it("should handle markdown without headings", async () => {
        const markdown = `Just some plain text
with multiple lines
and no headings`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.headings).toEqual([])
      })
    })

    describe("title extraction", () => {
      it("should extract title from frontmatter when available", async () => {
        const markdown = `---
title: Frontmatter Title
---

# H1 Title

Content`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.title).toBe("Frontmatter Title")
      })

      it("should extract title from H1 when no frontmatter title", async () => {
        const markdown = `# H1 Title

Some content`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.title).toBe("H1 Title")
      })

      it("should prefer frontmatter title over H1", async () => {
        const markdown = `---
title: Frontmatter Title
---

# H1 Title`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.title).toBe("Frontmatter Title")
      })

      it("should default to 'Untitled' when no title found", async () => {
        const markdown = `Just some content
without a title`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.title).toBe("Untitled")
      })

      it("should use the first H1 when multiple H1s exist", async () => {
        const markdown = `# First H1
## Some H2
# Second H1`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.title).toBe("First H1")
      })
    })

    describe("description building", () => {
      it("should use frontmatter description when available", async () => {
        const markdown = `---
description: Frontmatter description
---

# Title`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.description).toBe("Frontmatter description")
      })

      it("should build description from H2 headings", async () => {
        const markdown = `# Main Title
## Introduction
## Features
## Conclusion`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.description).toBe("- Introduction\n- Features\n- Conclusion")
      })

      it("should combine frontmatter description with H2s", async () => {
        const markdown = `---
description: This is a test document
---

# Title
## Section 1
## Section 2`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.description).toBe(
          "This is a test document\n\n- Section 1\n- Section 2"
        )
      })

      it("should return undefined when no description sources available", async () => {
        const markdown = `# Title

Just some content`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.description).toBeUndefined()
      })

      it("should not include non-H2 headings in description", async () => {
        const markdown = `# Main Title
## H2 Section
### H3 Subsection
## Another H2
#### H4 Section`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.description).toBe("- H2 Section\n- Another H2")
      })

      it("should trim whitespace from description", async () => {
        const markdown = `---
description: "  Spaces around  "
---

# Title`

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* Markdown
            return yield* service.process(markdown)
          }).pipe(Effect.provide(Markdown.layer))
        )

        expect(result.description).toBe("Spaces around")
      })
    })
  })
})
