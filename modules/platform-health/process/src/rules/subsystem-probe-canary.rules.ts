import { NOT_HANDLED_HEADER } from "@langwatch/process/not-handled";

/** Whether a handler saw the request; a refusal before one ran stored nothing. */
export type CanaryAnswer = Readonly<{ notHandled: false } | { notHandled: true; reason: string }>;

/** Reads a 503 our own door answered before any handler ran ("starting", "draining"). */
export function canaryAnswerOf(response: Response): CanaryAnswer {
  const reason = response.status === 503 ? response.headers.get(NOT_HANDLED_HEADER) : null;
  return reason === null ? { notHandled: false } : { notHandled: true, reason };
}

export function canaryHeaders(authToken: string, projectId: string | null): Record<string, string> {
  return {
    "X-Auth-Token": authToken,
    ...(projectId === null ? {} : { "X-Project-Id": projectId }),
    "Content-Type": "application/json",
  };
}

export function readbackHeaders(
  authToken: string,
  projectId: string | null,
): Record<string, string> {
  return {
    "X-Auth-Token": authToken,
    ...(projectId === null ? {} : { "X-Project-Id": projectId }),
  };
}

/** The OTLP body a canary is sent as, written out rather than borrowed. */
type CanaryOtelPayload = Readonly<{
  resourceSpans: readonly {
    resource: { attributes: readonly { key: string; value: { stringValue: string } }[] };
    scopeSpans: readonly {
      scope: { name: string };
      spans: readonly {
        traceId: string;
        spanId: string;
        name: string;
        kind: string;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        attributes: readonly { key: string; value: { stringValue: string } }[];
        status: Record<string, never>;
      }[];
    }[];
  }[];
}>;

type RestCanaryPayload = Readonly<{
  spans: readonly Record<string, unknown>[];
  metadata: { canary: true };
}>;

export function restCanaryPayload({
  traceId,
  input,
  now,
  spanId,
}: {
  traceId: string;
  input: string;
  now: number;
  spanId: string;
}): RestCanaryPayload {
  return {
    spans: [
      {
        trace_id: traceId,
        span_id: spanId,
        type: "span",
        input: { type: "text", value: input },
        output: { type: "text", value: "\u{1F4AF}" },
        timestamps: { started_at: now, finished_at: now },
      },
    ],
    metadata: { canary: true },
  };
}

export function otelCanaryPayload({
  traceId,
  input,
  model,
  nanos,
  spanId,
}: {
  traceId: string;
  input: string;
  model?: string;
  nanos: string;
  spanId: string;
}): CanaryOtelPayload {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "metadata.canary", value: { stringValue: "true" } }] },
        scopeSpans: [
          {
            scope: { name: "opentelemetry.langwatch.health_check" },
            spans: [
              {
                traceId,
                spanId,
                name: "Health check",
                kind: "SPAN_KIND_INTERNAL",
                startTimeUnixNano: nanos,
                endTimeUnixNano: nanos,
                attributes: [
                  ...(model === undefined
                    ? []
                    : [{ key: "gen_ai.request.model", value: { stringValue: model } }]),
                  { key: "gen_ai.prompt.0.role", value: { stringValue: "user" } },
                  { key: "gen_ai.prompt.0.content.0.text", value: { stringValue: input } },
                  { key: "gen_ai.completion.0.text", value: { stringValue: "\u{1F4AF}" } },
                ],
                status: {},
              },
            ],
          },
        ],
      },
    ],
  };
}
