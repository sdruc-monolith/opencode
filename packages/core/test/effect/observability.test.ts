import { afterEach, describe, expect, test } from "bun:test"
import { resource } from "@opencode-ai/core/effect/observability"

const otelResourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES
const opencodeClient = process.env.OPENCODE_CLIENT
const wandbEntity = process.env.WANDB_ENTITY
const wandbProject = process.env.WANDB_PROJECT

afterEach(() => {
  if (otelResourceAttributes === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES
  else process.env.OTEL_RESOURCE_ATTRIBUTES = otelResourceAttributes

  if (opencodeClient === undefined) delete process.env.OPENCODE_CLIENT
  else process.env.OPENCODE_CLIENT = opencodeClient

  if (wandbEntity === undefined) delete process.env.WANDB_ENTITY
  else process.env.WANDB_ENTITY = wandbEntity

  if (wandbProject === undefined) delete process.env.WANDB_PROJECT
  else process.env.WANDB_PROJECT = wandbProject
})

describe("resource", () => {
  test("parses and decodes OTEL resource attributes", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.namespace=anomalyco,team=platform%2Cobservability,label=hello%3Dworld,key%2Fname=value%20here"

    expect(resource().attributes).toMatchObject({
      "service.namespace": "anomalyco",
      team: "platform,observability",
      label: "hello=world",
      "key/name": "value here",
    })
  })

  test("drops OTEL resource attributes when any entry is invalid", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "service.namespace=anomalyco,broken"

    expect(resource().attributes["service.namespace"]).toBeUndefined()
    expect(resource().attributes["opencode.client"]).toBeDefined()
  })

  test("keeps built-in attributes when env values conflict", () => {
    process.env.OPENCODE_CLIENT = "cli"
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "opencode.client=web,service.instance.id=override,service.namespace=anomalyco"

    expect(resource().attributes).toMatchObject({
      "opencode.client": "cli",
      "service.namespace": "anomalyco",
    })
    expect(resource().attributes["service.instance.id"]).not.toBe("override")
  })

  test("adds W&B routing attributes from env", () => {
    process.env.WANDB_ENTITY = "opencode"
    process.env.WANDB_PROJECT = "agents"

    expect(resource().attributes).toMatchObject({
      "wandb.entity": "opencode",
      "wandb.project": "agents",
    })
  })
})
