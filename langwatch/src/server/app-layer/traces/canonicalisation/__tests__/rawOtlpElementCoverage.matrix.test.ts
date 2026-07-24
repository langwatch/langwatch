import { describe, expect, it } from "vitest";

import { CanonicalizeSpanAttributesService } from "../canonicalizeSpanAttributesService";
import type {
  NormalizedAttributes,
  NormalizedEvent,
} from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import type { ExtractorContext } from "../extractors/_types";

import codexBSpan from "./fixtures/codex-B.session_task_turn.json";
import geminiBSpan from "./fixtures/gemini-B.llm_call.json";
import opencodeBSpan from "./fixtures/opencode-B.doStream.json";

/**
 * Per-element canonicalization coverage, fed by the REAL Path B OTLP each coding
 * assistant sent on the wire (captured during the 2026-06-06 dogfood, dumps in
 * langwatch/.claude/dogfood-evidence/8cell-2026-06-06/<tool>-B/). Each tool's
 * raw span is pushed through the production CanonicalizeSpanAttributesService,
 * and every one of the nine telemetry elements is asserted PRESENT (a real
 * value was captured) or WIRE-ABSENT (the tool genuinely does not emit it —
 * cited per tool below).
 *
 * To validate a NEW element in future: add it to ELEMENTS plus each tool's
 * `expected` map here, and add the matching gateway-level row (Path A) — if a
 * tool stops emitting a GREEN element the matrix turns red.
 */

const svc = new CanonicalizeSpanAttributesService();

const SPAN_CTX = (
  scopeName: string,
  spanName: string,
): ExtractorContext["span"] => ({
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
}): NormalizedAttributes =>
  svc.canonicalize(
    fixture.attributes as NormalizedAttributes,
    [] as NormalizedEvent[],
    SPAN_CTX(fixture.scopeName, fixture.spanName),
  ).attributes;

// ── element extractors over the canonical attribute bag ─────────────────────
const str = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : String(v);

const ELEMENTS: {
  key: string;
  get: (a: NormalizedAttributes) => unknown;
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
      (a["gen_ai.request.model"] !== undefined &&
      a["gen_ai.usage.input_tokens"] !== undefined
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
    get: (a) =>
      a["gen_ai.input.messages"] ?? a["gen_ai.prompt"] ?? a["langwatch.input"],
  },
  {
    key: "output content",
    get: (a) =>
      a["gen_ai.output.messages"] ??
      a["gen_ai.completion"] ??
      a["langwatch.output"],
  },
];

type Status = "present" | "absent";

const TOOLS: {
  name: string;
  attrs: () => NormalizedAttributes;
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
      "cache read": "this captured turn created cache (cacheReadTokens=0); read shows on the next turn",
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
      for (const el of ELEMENTS) {
        const status = tool.expected[el.key];
        if (status === "present") {
          it(`captures ${el.key}`, () => {
            const v = str(el.get(attrs));
            expect(v, `${el.key} should be canonicalized`).toBeTruthy();
          });
        } else {
          it(`does not invent ${el.key} (WIRE-ABSENT: ${tool.absentReason[el.key]})`, () => {
            expect(el.get(attrs)).toBeUndefined();
          });
        }
      }
    });
  }
});
