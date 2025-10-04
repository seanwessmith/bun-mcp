import { NodeHttpClient } from "@effect/platform-node"
import { Effect, Layer, Schedule } from "effect"
import { Array } from "effect/collections"
import { Duration } from "effect/time"
import { McpServer } from "effect/unstable/ai"
import { HttpClient } from "effect/unstable/http"

const retryPolicy = Schedule.spaced(Duration.seconds(3))

export const pages = [
  {
    slug: "installation",
    name: "Bun Installation",
    title: "Installation — Bun Docs",
    description: `How to install Bun on macOS, Linux and Windows.`,
    url: "https://bun.com/docs/installation.md",
  },
  {
    slug: "quickstart",
    name: "Bun Quickstart",
    title: "Quickstart — Bun Docs",
    description: `Get started quickly with Bun projects and scripts.`,
    url: "https://bun.com/docs/quickstart.md",
  },
  {
    slug: "bundler",
    name: "Bun.build Bundler",
    title: "Bun.build – Bundler — Bun Docs",
    description: `Bundle code for the browser with Bun's native bundler.`,
    url: "https://bun.com/docs/bundler.md",
  },
  {
    slug: "runtime/bun-apis",
    name: "Bun Runtime APIs",
    title: "Runtime APIs — Bun Docs",
    description: `Overview of Bun runtime APIs and compatibility.`,
    url: "https://bun.com/docs/runtime/bun-apis.md",
  },
] as const

const makeBunResources = Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.retry(retryPolicy),
  )

  return Layer.mergeAll(
    ...Array.map(pages, (page) =>
      McpServer.resource({
        uri: `bun://doc/${page.slug}`,
        name: page.name,
        description: page.description,
        content: client.get(page.url).pipe(Effect.flatMap((res) => res.text)),
      }),
    ),
  )
})

export const BunResources = Layer.unwrap(makeBunResources).pipe(
  Layer.provide(NodeHttpClient.layerUndici),
)
