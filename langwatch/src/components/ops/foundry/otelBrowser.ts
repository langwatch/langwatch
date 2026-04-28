import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { attributes } from "langwatch/observability";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const PAT_PREFIX = "pat-lw-";

export function createFoundryProvider({
  apiKey,
  endpoint,
  projectId,
  resourceAttributes,
}: {
  apiKey: string;
  endpoint: string;
  /**
   * Required when `apiKey` is a Personal Access Token (`pat-lw-*`). The
   * unified auth middleware needs the project id alongside the PAT to
   * resolve the role binding. Optional for legacy `sk-lw-*` keys, which
   * encode project identity themselves.
   */
  projectId?: string;
  resourceAttributes: Record<string, string>;
}) {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: resourceAttributes["service.name"] ?? "foundry",
    [attributes.ATTR_LANGWATCH_SDK_LANGUAGE]: "typescript",
    [attributes.ATTR_LANGWATCH_SDK_NAME]: "langwatch-foundry-sdk",
    [attributes.ATTR_LANGWATCH_SDK_VERSION]: "0.0.1",
    ...(resourceAttributes["service.version"]
      ? { [ATTR_SERVICE_VERSION]: resourceAttributes["service.version"] }
      : {}),
  });

  const url = new URL("/api/otel/v1/traces", endpoint).toString();

  const isPat = apiKey.startsWith(PAT_PREFIX);
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "x-langwatch-sdk-name": "langwatch-foundry",
    "x-langwatch-sdk-language": "typescript",
    "x-langwatch-sdk-runtime": "web",
  };
  if (isPat && projectId) {
    headers["x-project-id"] = projectId;
  }

  const exporter = new OTLPTraceExporter({
    url,
    headers,
    // Foundry's interactive UI has been running with this concurrency
    // for a long time without issues. The empty-state sample loader
    // mirrors Foundry's per-trace send pattern, so the same value
    // works for both.
    concurrencyLimit: 64,
    // Per-fetch AbortSignal timeout (separate from the
    // BatchSpanProcessor's flush timeout). Local dev servers can be
    // slow on the first request after a cold start, so be generous.
    timeoutMillis: 60_000,
  });

  const provider = new WebTracerProvider({
    resource,
    // Match Foundry's interactive defaults — that flow drives traces
    // reliably one-per-provider, so we want the same processor sizing
    // here. Smaller batches keep request bodies well under any body
    // cap; the foundry can produce a couple of hundred spans per
    // trace at most, so 256 is plenty without ever splitting.
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        maxExportBatchSize: 256,
        maxQueueSize: 8192,
        scheduledDelayMillis: 50,
        exportTimeoutMillis: 30_000,
      }),
    ],
  });

  return provider;
}

