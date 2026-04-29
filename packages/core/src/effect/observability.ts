import { Effect, Layer, Logger } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpLogger, OtlpSerialization } from "effect/unstable/observability"
import * as EffectLogger from "./logger"
import { Flag } from "../flag/flag"
import { InstallationChannel, InstallationVersion } from "../installation/version"
import { ensureProcessMetadata } from "../util/opencode-process"

const processID = crypto.randomUUID()

export type Config = {
  otel_endpoint?: string
  otel_headers?: string
  wandb_api_key?: string
  wandb_base_url?: string
  wandb_entity?: string
  wandb_project?: string
}

function parseHeaders(input?: string) {
  if (!input) return {}
  return input.split(",").reduce(
    (acc, item) => {
      const [key, ...value] = item.split("=")
      const trimmed = key.trim()
      if (!trimmed) return acc
      acc[trimmed] = value.join("=").trim()
      return acc
    },
    {} as Record<string, string>,
  )
}

function isWandbEndpoint(endpoint: string) {
  return endpoint.includes("wandb")
}

function resolveEndpoints(config: Config) {
  const base =
    config.otel_endpoint ??
    (config.wandb_api_key
      ? `${(config.wandb_base_url ?? "https://trace.wandb.ai").replace(/\/+$/, "")}/otel`
      : undefined)
  if (!base) return
  const normalized = base.replace(/\/+$/, "")
  const tracesBase = normalized.endsWith("/v1/traces") ? normalized.replace(/\/v1\/traces$/, "") : normalized
  const traces = `${tracesBase}/v1/traces`
  if (isWandbEndpoint(traces)) return { traces, logs: undefined }
  return {
    traces,
    logs: `${tracesBase}/v1/logs`,
  }
}

function resolveHeaders(config: Config, tracesEndpoint: string) {
  const parsed = parseHeaders(config.otel_headers)
  if (!isWandbEndpoint(tracesEndpoint)) return parsed
  const headers = { ...parsed }
  const hasAuthorization = Object.keys(headers).some((key) => key.toLowerCase() === "authorization")
  if (config.wandb_api_key && !headers["wandb-api-key"] && !hasAuthorization) {
    headers["wandb-api-key"] = config.wandb_api_key
  }
  if (config.wandb_entity && config.wandb_project && !headers.project_id) {
    headers.project_id = `${config.wandb_entity}/${config.wandb_project}`
  }
  return headers
}

function resolveConfig(config?: Config): Config {
  return {
    otel_endpoint: config?.otel_endpoint ?? Flag.OTEL_EXPORTER_OTLP_ENDPOINT,
    otel_headers: config?.otel_headers ?? Flag.OTEL_EXPORTER_OTLP_HEADERS,
    wandb_api_key: config?.wandb_api_key ?? Flag.WANDB_API_KEY,
    wandb_base_url: config?.wandb_base_url ?? Flag.WANDB_BASE_URL,
    wandb_entity: config?.wandb_entity ?? Flag.WANDB_ENTITY,
    wandb_project: config?.wandb_project ?? Flag.WANDB_PROJECT,
  }
}

export const enabled = !!resolveEndpoints(resolveConfig())

export function resource(config?: Config): { serviceName: string; serviceVersion: string; attributes: Record<string, string> } {
  const resolved = resolveConfig(config)
  const processMetadata = ensureProcessMetadata("main")
  const attributes: Record<string, string> = (() => {
    const value = process.env.OTEL_RESOURCE_ATTRIBUTES
    if (!value) return {}
    try {
      return Object.fromEntries(
        value.split(",").map((entry) => {
          const index = entry.indexOf("=")
          if (index < 1) throw new Error("Invalid OTEL_RESOURCE_ATTRIBUTES entry")
          return [decodeURIComponent(entry.slice(0, index)), decodeURIComponent(entry.slice(index + 1))]
        }),
      )
    } catch {
      return {}
    }
  })()

  return {
    serviceName: "opencode",
    serviceVersion: InstallationVersion,
    attributes: {
      ...attributes,
      ...(resolved.wandb_entity ? { "wandb.entity": resolved.wandb_entity } : {}),
      ...(resolved.wandb_project ? { "wandb.project": resolved.wandb_project } : {}),
      "deployment.environment.name": InstallationChannel,
      "opencode.client": Flag.OPENCODE_CLIENT,
      "opencode.process_role": processMetadata.processRole,
      "opencode.run_id": processMetadata.runID,
      "service.instance.id": processID,
    },
  }
}

function logs(url: string, config: Config) {
  const headers = resolveHeaders(config, url)
  return Logger.layer(
    [
      EffectLogger.logger,
      OtlpLogger.make({
        url,
        resource: resource(config),
        headers,
      }),
    ],
    { mergeWithExisting: false },
  ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer))
}

const traces = async (url: string, config: Config) => {
  const headers = resolveHeaders(config, url)
  const NodeSdk = await import("@effect/opentelemetry/NodeSdk")
  const OTLP = await import("@opentelemetry/exporter-trace-otlp-proto")
  const SdkBase = await import("@opentelemetry/sdk-trace-base")

  // @effect/opentelemetry creates a NodeTracerProvider but never calls
  // register(), so the global @opentelemetry/api context manager stays
  // as the no-op default. Non-Effect code (like the AI SDK) that calls
  // tracer.startActiveSpan() relies on context.active() to find the
  // parent span - without a real context manager every span starts a
  // new trace. Registering AsyncLocalStorageContextManager fixes this.
  const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks")
  const { context } = await import("@opentelemetry/api")
  const mgr = new AsyncLocalStorageContextManager()
  mgr.enable()
  context.setGlobalContextManager(mgr)

  return NodeSdk.layer(() => ({
    resource: resource(config),
    spanProcessor: new SdkBase.BatchSpanProcessor(
      new OTLP.OTLPTraceExporter({
        url,
        headers,
      }),
    ),
  }))
}

export function layerWith(config?: Config) {
  const resolved = resolveConfig(config)
  const endpoints = resolveEndpoints(resolved)
  if (!endpoints) return EffectLogger.layer
  return Layer.unwrap(
    Effect.gen(function* () {
      const trace = yield* Effect.promise(() => traces(endpoints.traces, resolved))
      if (!endpoints.logs) return Layer.merge(trace, EffectLogger.layer)
      return Layer.mergeAll(trace, logs(endpoints.logs, resolved))
    }),
  )
}

export const layer = layerWith()

export const Observability = { enabled, layer }
