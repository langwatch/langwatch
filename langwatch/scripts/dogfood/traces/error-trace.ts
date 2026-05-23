/**
 * Emit one OTLP trace with a chain of error spans, intended for the
 * StatusChip interactive-tooltip dogfood. Mirrors the screenshot the
 * customer report used to motivate the work, a top-level workflow
 * span errors with "Connection error.", and a couple of llm + chain
 * leaf spans error underneath so the popover has multiple chips.
 *
 * Usage:
 *   LW_API_KEY=sk-lw-... LW_ENDPOINT=http://localhost:5560 \
 *     npx tsx langwatch/scripts/dogfood/traces/error-trace.ts
 */
import { randomBytes } from "node:crypto";

const ENDPOINT = process.env.LW_ENDPOINT ?? "http://localhost:5560";
const API_KEY = process.env.LW_API_KEY;
if (!API_KEY) {
  console.error("LW_API_KEY is required");
  process.exit(1);
}

const NOW_NS = BigInt(Date.now()) * 1_000_000n;

function id(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

const traceId = id(16);
const root = id(8);
const llmChat = id(8);
const llmRetry = id(8);
const chain = id(8);
const chainInner = id(8);

interface SpanInput {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startOffsetSec: number;
  durationSec: number;
  attrs?: Record<string, string | number | boolean>;
  errorMessage?: string;
}

const spans: SpanInput[] = [
  {
    spanId: root,
    name: "Deliverables Checklist",
    startOffsetSec: 0,
    durationSec: 6,
    errorMessage: "Connection error.",
    attrs: { "langwatch.span.type": "workflow" },
  },
  {
    spanId: chain,
    parentSpanId: root,
    name: "RunnableSequence",
    startOffsetSec: 0.2,
    durationSec: 5.5,
    errorMessage: "Connection error.",
    attrs: { "langwatch.span.type": "chain" },
  },
  {
    spanId: chainInner,
    parentSpanId: chain,
    name: "RunnableSequence",
    startOffsetSec: 0.4,
    durationSec: 5,
    errorMessage: "Connection error.",
    attrs: { "langwatch.span.type": "chain" },
  },
  {
    spanId: llmChat,
    parentSpanId: chainInner,
    name: "llm",
    startOffsetSec: 0.6,
    durationSec: 2,
    errorMessage:
      "Connection error.\n  at OpenAIClient.request (node_modules/openai/src/client.ts:312:23)",
    attrs: {
      "langwatch.span.type": "llm",
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
    },
  },
  {
    spanId: llmRetry,
    parentSpanId: chainInner,
    name: "llm",
    startOffsetSec: 3,
    durationSec: 2,
    errorMessage:
      "Connection error.\n  at OpenAIClient.request (node_modules/openai/src/client.ts:312:23)",
    attrs: {
      "langwatch.span.type": "llm",
      "gen_ai.system": "openai",
      "gen_ai.request.model": "gpt-4o",
    },
  },
];

function toAttrValue(v: string | number | boolean) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { intValue: v } : { doubleValue: v };
  return { boolValue: v };
}

const otlpSpans = spans.map((s) => {
  const start = NOW_NS + BigInt(Math.floor(s.startOffsetSec * 1e9));
  const end = start + BigInt(Math.floor(s.durationSec * 1e9));
  return {
    traceId,
    spanId: s.spanId,
    parentSpanId: s.parentSpanId,
    name: s.name,
    kind: 1,
    startTimeUnixNano: start.toString(),
    endTimeUnixNano: end.toString(),
    attributes: Object.entries(s.attrs ?? {}).map(([key, value]) => ({
      key,
      value: toAttrValue(value),
    })),
    status: s.errorMessage
      ? { code: 2, message: s.errorMessage }
      : undefined,
    events: s.errorMessage
      ? [
          {
            name: "exception",
            timeUnixNano: end.toString(),
            attributes: [
              {
                key: "exception.type",
                value: { stringValue: "ConnectionError" },
              },
              {
                key: "exception.message",
                value: { stringValue: s.errorMessage },
              },
              {
                key: "exception.stacktrace",
                value: {
                  stringValue:
                    s.errorMessage +
                    "\n  at Loop.tick (node_modules/openai/src/loop.ts:84:10)",
                },
              },
            ],
          },
        ]
      : [],
  };
});

const payload = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "deliverables-api" } },
          { key: "service.version", value: { stringValue: "0.4.7" } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "@langwatch/dogfood-error-trace", version: "1.0.0" },
          spans: otlpSpans,
        },
      ],
    },
  ],
};

async function main() {
  const url = `${ENDPOINT}/api/otel/v1/traces`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log(`POST ${url} -> ${res.status}`);
  if (text) console.log(text);
  console.log(`\nTrace id: ${traceId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
