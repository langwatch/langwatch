#!/usr/bin/env node
// Prints one OTLP/JSON trace export for the rehearsal's seed and load generator (plan section F,
// phase 0: "OTLP traces and spans in the current and previous month").
// Usage: otlp-batch.mjs <service-name> <trace-count> [<iso-instant>]

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const hex = (bytes) => randomBytes(bytes).toString("hex");
const nanos = (ms) => `${BigInt(ms) * 1_000_000n}`;

/** The same day and time one calendar month earlier, clamped to that month's last day. */
export function previousMonth({ at }) {
  const date = new Date(at);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

/** An OTLP/JSON export of `count` two-span traces; even traces now, odd a month earlier. */
export function otlpBatch({ service, count, at, randomHex = hex }) {
  const now = new Date(at).getTime();
  const before = previousMonth({ at }).getTime();
  const spans = [];
  for (let i = 0; i < count; i++) {
    const start = (i % 2 === 0 ? now : before) - 60_000 + i;
    const traceId = randomHex(16);
    const rootId = randomHex(8);
    spans.push(
      {
        traceId,
        spanId: rootId,
        name: "rehearsal.request",
        kind: 2,
        startTimeUnixNano: nanos(start),
        endTimeUnixNano: nanos(start + 120),
        attributes: [
          { key: "langwatch.input", value: { stringValue: `rehearsal input ${i}` } },
          { key: "langwatch.output", value: { stringValue: `rehearsal output ${i}` } },
        ],
      },
      {
        traceId,
        spanId: randomHex(8),
        parentSpanId: rootId,
        name: "rehearsal.llm",
        kind: 3,
        startTimeUnixNano: nanos(start + 10),
        endTimeUnixNano: nanos(start + 100),
        attributes: [
          { key: "gen_ai.request.model", value: { stringValue: "rehearsal-model" } },
          { key: "gen_ai.usage.input_tokens", value: { intValue: "12" } },
          { key: "gen_ai.usage.output_tokens", value: { intValue: "7" } },
        ],
      },
    );
  }
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
        scopeSpans: [{ scope: { name: "upgrade-rehearsal" }, spans }],
      },
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [service, count, at] = process.argv.slice(2);
  if (!service || !count) {
    process.stderr.write("usage: otlp-batch.mjs <service-name> <trace-count> [<iso-instant>]\n");
    process.exit(2);
  }
  const batch = otlpBatch({ service, count: Number(count), at: at ?? new Date().toISOString() });
  process.stdout.write(JSON.stringify(batch));
}
