import { Effect, Layer, ServiceMap } from "effect"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkStringify from "remark-stringify"
import remarkFrontmatter from "remark-frontmatter"
import remarkParseFrontmatter from "remark-parse-frontmatter"
import type { Node } from "unist"

type NodeWithChildren = Node & {
  depth?: number
  value?: string
  children: Array<NodeWithChildren>
}

export class Markdown extends ServiceMap.Key<Markdown>()("Markdown", {
  make: Effect.gen(function* () {
    const processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatter)
      .use(remarkParseFrontmatter)
      .use(() => (tree, file) => {
        if (tree.type !== "root") return
        const root = tree as NodeWithChildren
        const headings: Array<{ depth: number; text: string }> = []
        file.data.headings = headings
        for (const node of root.children) {
          if (node.type !== "heading") continue
          const text = node.children
            .flatMap((n) => (n.type === "text" ? [n.value] : []))
            .join("")
          headings.push({
            depth: node.depth!,
            text,
          })
        }
      })
      .use(remarkStringify)

    const process = (markdown: string) =>
      Effect.promise(() => processor.process(markdown)).pipe(
        Effect.map((vfile) => {
          const frontmatter = (vfile.data.frontmatter ?? {}) as Record<string, string>
          const headings = (vfile.data.headings ?? []) as Array<{
            depth: number
            text: string
          }>
          const h2s = headings
            .filter((h) => h.depth === 2)
            .map((h) => h.text)
            .join("\n- ")
          const title = frontmatter.title ?? headings.find((h) => h.depth === 1)?.text
          const descriptionParts = [frontmatter.description]
          if (h2s.length > 0) {
            descriptionParts.push(`- ${h2s}`)
          }
          const description = descriptionParts
            .filter((part): part is string => Boolean(part && part.trim().length > 0))
            .join("\n\n")
            .trim()
          return {
            title: title ?? "Untitled",
            description: description.length > 0 ? description : undefined,
            frontmatter,
            headings,
            content: vfile.value as string,
          }
        }),
      )

    return { process } as const
  }),
}) {
  static layer = Layer.effect(this)(this.make)
}
