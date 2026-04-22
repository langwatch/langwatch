/**
 * Sends a handful of synthetic traces that exercise the edge cases of
 * `getLastOutputAsText` / `typedValueToText`. Run locally against a dev
 * LangWatch instance to verify the trace list + "Add to Dataset" mapping
 * show meaningful output (instead of `<empty>`) for each case.
 *
 * Usage:
 *   LANGWATCH_ENDPOINT=http://localhost:5560 \
 *   LANGWATCH_API_KEY=sk-lw-... \
 *   pnpm tsx scripts/send-fake-output-traces.ts
 */
import { nanoid } from "nanoid";

const LANGWATCH_ENDPOINT =
  process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560";
const LANGWATCH_API_KEY = process.env.LANGWATCH_API_KEY;

if (!LANGWATCH_API_KEY) {
  console.error("LANGWATCH_API_KEY is not set");
  process.exit(1);
}

type Payload = {
  label: string;
  spans: any[];
};

const now = Date.now();
const t = (offsetMs: number) => now + offsetMs;

// Case 1: nested-wrapper output ({ data: { content: "..." } }) — should show "COMPANY_ANALYSIS".
const case1_nestedWrapper: Payload = {
  label: "nested-wrapper ({ data: { content } })",
  spans: [
    {
      trace_id: `trace_${nanoid()}`,
      span_id: `span_${nanoid()}`,
      type: "span",
      name: "analysis.task",
      input: { type: "text", value: "analyze this property" },
      output: {
        type: "json",
        value: {
          data: {
            content: "COMPANY_ANALYSIS",
            formatName: "standard",
            formattedProperties: "foo",
            addresses: [{ street: "1 Main St" }],
          },
        },
      },
      timestamps: { started_at: t(0), finished_at: t(100) },
    },
  ],
};

// Case 2: last-finishing span has unrenderable output (unstructured list),
// earlier span has the real output. Pre-fix: trace.output.value = "".
// Post-fix: falls back to the earlier span's real output.
const case2TraceId = `trace_${nanoid()}`;
const case2_lastSpanEmpty: Payload = {
  label: "last-finishing span renders empty; fallback to earlier",
  spans: [
    {
      trace_id: case2TraceId,
      span_id: `span_${nanoid()}`,
      parent_id: null,
      type: "span",
      name: "main.answer",
      input: { type: "text", value: "what is the answer?" },
      output: {
        type: "json",
        value: { data: { content: "the real answer is 42" } },
      },
      timestamps: { started_at: t(0), finished_at: t(100) },
    },
    {
      trace_id: case2TraceId,
      span_id: `span_${nanoid()}`,
      parent_id: null,
      type: "span",
      name: "post.callback",
      // Post-callback span finishes last. Its payload has no "real" content —
      // just an empty `content` string plus bookkeeping fields. On the
      // ClickHouse/event-sourcing path this used to store ComputedOutput = NULL
      // (because `extractRichIOFromSpan` returned null when no key matched and
      // the raw was a non-string object). With the fix, `stringifyForText`
      // falls back to `JSON.stringify(raw)` so the field is non-null.
      // (CodeRabbit suggested using `type: "list", value: ["plain", 1]` instead,
      // but the REST collector's schema validator rejects primitive list items.)
      output: {
        type: "json",
        value: { content: "", status: "done", extra: "noise" },
      },
      timestamps: { started_at: t(50), finished_at: t(200) },
    },
  ],
};

// Case 3: empty top-level special key + sibling content — pre-fix short-circuited to "".
const case3_emptySpecialKey: Payload = {
  label: "empty special key ({ content: '', formatName, ... })",
  spans: [
    {
      trace_id: `trace_${nanoid()}`,
      span_id: `span_${nanoid()}`,
      type: "span",
      name: "mixed.fields",
      input: { type: "text", value: "ping" },
      output: {
        type: "json",
        value: {
          content: "",
          formatName: "standard",
          formattedProperties: "foo",
        },
      },
      timestamps: { started_at: t(0), finished_at: t(100) },
    },
  ],
};

// Case 4: `json.query` — pre-fix returned `json.user_query` (typo). Now returns query.
const case4_queryTypo: Payload = {
  label: "json.query (was broken by typo)",
  spans: [
    {
      trace_id: `trace_${nanoid()}`,
      span_id: `span_${nanoid()}`,
      type: "span",
      name: "query.handler",
      input: {
        type: "json",
        value: { query: "what is the weather in Rotterdam?" },
      },
      output: { type: "text", value: "sunny, 18C" },
      timestamps: { started_at: t(0), finished_at: t(100) },
    },
  ],
};

const payloads: Payload[] = [
  case1_nestedWrapper,
  case2_lastSpanEmpty,
  case3_emptySpecialKey,
  case4_queryTypo,
];

async function send(payload: Payload) {
  const res = await fetch(`${LANGWATCH_ENDPOINT}/api/collector`, {
    method: "POST",
    headers: {
      "X-Auth-Token": LANGWATCH_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      spans: payload.spans,
      metadata: { labels: ["fake-output-traces", payload.label] },
    }),
  });
  const traceId = payload.spans[0]?.trace_id;
  console.log(
    `${res.ok ? "[ok]" : "[err]"} ${res.status} — ${payload.label} — trace_id=${traceId}`,
  );
  if (!res.ok) console.log(await res.text());
}

async function main() {
  for (const p of payloads) {
    await send(p);
  }
  console.log(
    "\nOpen the Traces list in LangWatch and check the Output column for each trace_id.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
