/**
 * One demo trace as an OTLP/JSON export, the attributes an instrumented app sends. OTLP and
 * not the REST collector, because only OTLP carries span attributes such as gen_ai.agent.name.
 * The keys follow what the collector itself writes for the same span fields.
 */
import type { CollectorRESTParams, Span } from "@langwatch/trace-contract";

type OtlpValue = { stringValue: string } | { doubleValue: number } | { boolValue: boolean };

interface OtlpAttribute {
  key: string;
  value: OtlpValue;
}

/** Metadata the collector lifts to its own resource attribute rather than a metadata key. */
const RESERVED_METADATA: Record<string, string> = {
  thread_id: "langwatch.thread.id",
  user_id: "langwatch.user.id",
  customer_id: "langwatch.customer.id",
  sdk_language: "langwatch.sdk.language",
};

const METRIC_ATTRIBUTES = [
  ["prompt_tokens", "gen_ai.usage.input_tokens"],
  ["completion_tokens", "gen_ai.usage.output_tokens"],
  ["cost", "langwatch.span.cost"],
] as const;

function attribute(key: string, value: unknown): OtlpAttribute[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [{ key, value: { stringValue: value } }];
  if (typeof value === "number") return [{ key, value: { doubleValue: value } }];
  if (typeof value === "boolean") return [{ key, value: { boolValue: value } }];
  return [{ key, value: { stringValue: JSON.stringify(value) } }];
}

const nanos = (ms: number) => `${Math.round(ms)}000000`;

function resourceAttributes({
  serviceName,
  metadata,
}: {
  serviceName: string;
  metadata: CollectorRESTParams["metadata"];
}): OtlpAttribute[] {
  const attributes = attribute("service.name", serviceName);
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (key === "labels") {
      if (Array.isArray(value) && value.length > 0) {
        attributes.push(...attribute("langwatch.labels", JSON.stringify(value)));
      }
      continue;
    }
    attributes.push(...attribute(RESERVED_METADATA[key] ?? `langwatch.metadata.${key}`, value));
  }
  return attributes;
}

function spanAttributes(span: Span): OtlpAttribute[] {
  const attributes = attribute("langwatch.span.type", span.type);
  if (span.input) attributes.push(...attribute("langwatch.input", JSON.stringify(span.input)));
  if (span.output) attributes.push(...attribute("langwatch.output", JSON.stringify(span.output)));
  if ("model" in span) attributes.push(...attribute("gen_ai.request.model", span.model));
  if ("contexts" in span && span.contexts) {
    attributes.push(...attribute("langwatch.rag.contexts", JSON.stringify(span.contexts)));
  }
  for (const [field, key] of METRIC_ATTRIBUTES) {
    attributes.push(...attribute(key, span.metrics?.[field]));
  }
  for (const [key, value] of Object.entries(span.params ?? {})) {
    attributes.push(...attribute(key, value));
  }
  if (span.error) {
    attributes.push(
      ...attribute("error.has_error", true),
      ...attribute("error.message", span.error.message),
    );
  }
  return attributes;
}

/** One trace as an OTLP resourceSpans entry; an export body carries a batch of them. */
export function otlpResourceSpans({
  serviceName,
  body,
}: {
  /** The service that emits it: the agent's name. */
  serviceName: string;
  body: CollectorRESTParams;
}): object {
  return {
    resource: { attributes: resourceAttributes({ serviceName, metadata: body.metadata }) },
    scopeSpans: [
      {
        scope: { name: "langwatch-dashboards-demo" },
        spans: body.spans.map((span) => ({
          traceId: span.trace_id,
          spanId: span.span_id,
          ...(span.parent_id ? { parentSpanId: span.parent_id } : {}),
          name: span.name ?? span.type,
          kind: 1,
          startTimeUnixNano: nanos(span.timestamps.started_at),
          endTimeUnixNano: nanos(span.timestamps.finished_at),
          attributes: spanAttributes(span),
          events: span.timestamps.first_token_at
            ? [
                {
                  name: "first_token",
                  timeUnixNano: nanos(span.timestamps.first_token_at),
                  // The receiver drops a span whose event has no attribute list.
                  attributes: [],
                },
              ]
            : [],
          status: span.error ? { code: 2, message: span.error.message } : { code: 1 },
        })),
      },
    ],
  };
}
