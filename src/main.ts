#!/usr/bin/env node
import { NodeRuntime, NodeSink, NodeStream } from "@effect/platform-node"
import { Layer } from "effect"
import { ReferenceDocsTools } from "./ReferenceDocs.js"
import { Readmes } from "./Readmes.js"
import { McpServer } from "effect/unstable/ai"
import { Logger } from "effect/logging"
import pkg from "../package.json" with { type: "json" }

McpServer.layerStdio({
  name: pkg.name,
  version: pkg.version,
  stdin: NodeStream.stdin,
  stdout: NodeSink.stdout,
}).pipe(
  Layer.provide([ReferenceDocsTools, Readmes]),
  Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
  Layer.launch,
  NodeRuntime.runMain,
)
