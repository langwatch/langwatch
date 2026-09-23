import type { CanonicalAttributes, CanonicalEvent } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type { ExtractorContext } from "../canonical-attributes.service.ts";
import { canonicalisation } from "./canonicalisation/test-helpers.ts";
import codexBSpan from "./fixtures/codex-b.session-task-turn.json";
import geminiBSpan from "./fixtures/gemini-b.llm-call.json";
import opencodeBSpan from "./fixtures/opencode-b.do-stream.json";

/**
 * Per-element canonicalization coverage for Path B telemetry from real coding assistants.
 * Asserts each of nine telemetry elements PRESENT or WIRE-ABSENT; add new elements to ELEMENTS.
 */

const SPAN_CTX = (scopeName: string, spanName: string): ExtractorContext["span"] => ({
  name: spanName,
  kind: 0,
  instrumentationScope: { name: scopeName, version: null },
  statusMessage: null,
  statusCode: null,
  parentSpanId: null,
});

const canonicalizeSpan = (fixture: {
  scopeName: string;
  spanName: string;
  attributes: Record<string, unknown>;
}): CanonicalAttributes =>
  canonicalisation.canonicalizeSpanAttributes({
    spanAttributes: fixture.attributes as CanonicalAttributes,
    events: [] as CanonicalEvent[],
    span: SPAN_CTX(fixture.scopeName, fixture.spanName),
  }).attributes;

// ── element extractors over the canonical attribute bag ─────────────────────
const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  return typeof v === "string" ? v : JSON.stringify(v);
};

const ELEMENTS: {
  key: string;
  get: (a: CanonicalAttributes) => unknown;
}[] = [
  { key: "model", get: (a) => a["gen_ai.request.model"] },
  { key: "input tokens", get: (a) => a["gen_ai.usage.input_tokens"] },
  { key: "output tokens", get: (a) => a["gen_ai.usage.output_tokens"] },
  {
    // cost is computed downstream from model + tokens; claude-code also carries
    // the provider's own figure on langwatch.span.cost. "present" === costable.
    key: "cost",
    get: (a) =>
      a["langwatch.span.cost"] ??
      (a["gen_ai.request.model"] !== undefined && a["gen_ai.usage.input_tokens"] !== undefined
        ? "costable"
        : undefined),
  },
  {
    key: "cache read",
    get: (a) => a["gen_ai.usage.cache_read.input_tokens"],
  },
  {
    key: "cache write",
    get: (a) => a["gen_ai.usage.cache_creation.input_tokens"],
  },
  {
    key: "session id",
    get: (a) => a["gen_ai.conversation.id"] ?? a["langwatch.thread.id"],
  },
  {
    key: "input content",
    get: (a) => a["gen_ai.input.messages"] ?? a["gen_ai.prompt"] ?? a["langwatch.input"],
  },
  {
    key: "output content",
    get: (a) => a["gen_ai.output.messages"] ?? a["gen_ai.completion"] ?? a["langwatch.output"],
  },
];

type Status = "present" | "absent";

const TOOLS: {
  name: string;
  attrs: () => CanonicalAttributes;
  // why each absent element is genuinely off the wire for this tool
  absentReason: Record<string, string>;
  expected: Record<string, Status>;
}[] = [
  {
    name: "codex-B (codex_cli_rs session_task.turn span)",
    attrs: () => canonicalizeSpan(codexBSpan),
    absentReason: {
      "cache write": "OpenAI usage exposes only cached (read) tokens, no creation count",
      "input content": "codex OTLP carries token counts only, no message bodies",
      "output content": "codex OTLP carries token counts only, no message bodies",
    },
    expected: {
      model: "present",
      "input tokens": "present",
      "output tokens": "present",
      cost: "present",
      "cache read": "present",
      "cache write": "absent",
      "session id": "present",
      "input content": "absent",
      "output content": "absent",
    },
  },
  {
    name: "gemini-B (gemini-cli llm_call span)",
    attrs: () => canonicalizeSpan(geminiBSpan),
    absentReason: {
      "cache read": "gemini-cli OTLP carries no cache token field",
      "cache write": "gemini-cli OTLP carries no cache token field",
    },
    expected: {
      model: "present",
      "input tokens": "present",
      "output tokens": "present",
      cost: "present",
      "cache read": "absent",
      "cache write": "absent",
      "session id": "present",
      "input content": "present",
      "output content": "present",
    },
  },
  {
    name: "opencode-B (Vercel AI SDK ai.streamText.doStream span, cache-creation turn)",
    attrs: () => canonicalizeSpan(opencodeBSpan),
    absentReason: {
      "cache read":
        "this captured turn created cache (cacheReadTokens=0); read shows on the next turn",
    },
    expected: {
      model: "present",
      "input tokens": "present",
      "output tokens": "present",
      cost: "present",
      "cache read": "absent",
      "cache write": "present",
      "session id": "present",
      "input content": "present",
      "output content": "present",
    },
  },
];

describe("Path B per-element canonicalization coverage (real OTLP dumps)", () => {
  for (const tool of TOOLS) {
    describe(`given ${tool.name}`, () => {
      const attrs = tool.attrs();
      for (const el of ELEMENTS.filter((element) => tool.expected[element.key] === "present")) {
        it(`captures ${el.key}`, () => {
          const v = str(el.get(attrs));
          expect(v, `${el.key} should be canonicalized`).toBeTruthy();
        });
      }
      for (const el of ELEMENTS.filter((element) => tool.expected[element.key] === "absent")) {
        it(`does not invent ${el.key} (WIRE-ABSENT: ${tool.absentReason[el.key]})`, () => {
          expect(el.get(attrs)).toBeUndefined();
        });
      }
    });
  }
});
