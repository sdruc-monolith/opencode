import { Config } from "@/config/config"
import * as CoreObservability from "@opencode-ai/core/effect/observability"
import { Effect, Layer } from "effect"

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const service = yield* Config.Service
    const config = yield* service.get().pipe(Effect.catch(() => service.getGlobal()))
    const experimental = config.experimental
    return CoreObservability.layerWith({
      otel_endpoint: experimental?.openTelemetryEndpoint,
      otel_headers: experimental?.openTelemetryHeaders,
      wandb_base_url: experimental?.wandbBaseUrl,
      wandb_entity: experimental?.wandbEntity,
      wandb_project: experimental?.wandbProject,
    })
  }).pipe(
    Effect.catch(() => Effect.succeed(CoreObservability.layerWith())),
    Effect.provide(Config.defaultLayer),
  ),
)

export const Observability = {
  layer,
}

export * as AppObservability from "./observability"
