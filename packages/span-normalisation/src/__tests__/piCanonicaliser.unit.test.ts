/**
 * Every attribute key and value here is one pi 0.84.2 declares in
 * `@earendil-works/pi-agent-core`'s `HARNESS_TELEMETRY_SCHEMA` /
 * `AI_TELEMETRY_SCHEMA`. Inventing a plausible key would prove nothing.
 */
import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../attributeKeys.ts";
import { PiCanonicaliserService } from "../piCanonicaliser.ts";
import { canonicaliseSpanAttributes, orderedSpanCanonicalisers } from "../spanCanonicalisation.ts";
import { createExtractorContext } from "./testHelpers.ts";

const codexScopes = { isCodexScope: () => false, execScope: "codex_exec" };

/** The whole ordered chain, as ingestion runs it: pi relies on the GenAI pass before it. */
function canonicaliseWholeChain({
  name,
  spanAttributes,
}: {
  name: string;
  spanAttributes: Record<string, unknown>;
}) {
  return canonicaliseSpanAttributes({
    canonicalisers: orderedSpanCanonicalisers({ codexScopes }),
    spanAttributes,
    events: [],
    span: {
      name,
      kind: null,
      // pi's scope is its package name; the match is on the span name regardless.
      instrumentationScope: { name: "@earendil-works/pi-agent-core" },
      statusMessage: null,
      statusCode: null,
      parentSpanId: null,
    },
  });
}

describe("the pi canonicaliser", () => {
  /** @scenario "A pi model-call span yields model and token usage on the canonical trace" */
  it("lifts model and token usage from pi's dual-written convention keys", () => {
    const { attributes } = canonicaliseWholeChain({
      name: "pi.ai.request",
      spanAttributes: {
        "gen_ai.request.model": "claude-opus-4-7",
        "gen_ai.usage.input_tokens": 120,
        "gen_ai.usage.output_tokens": 30,
        "pi.ai.model": "claude-opus-4-7",
        "pi.ai.usage.input_tokens": 120,
        "pi.ai.usage.output_tokens": 30,
        "pi.session.id": "s-1",
      },
    });

    expect(attributes[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("claude-opus-4-7");
    expect(attributes[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(120);
    expect(attributes[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(30);
    expect(attributes[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
  });

  /** @scenario "A pi tool span canonicalises as a tool span" */
  it("types a pi.harness.tool span as a tool run and keeps its tool name", () => {
    const { attributes } = canonicaliseWholeChain({
      name: "pi.harness.tool",
      spanAttributes: { "pi.tool.name": "bash", "pi.session.id": "s-1" },
    });

    expect(attributes[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
    expect(attributes[ATTR_KEYS.GEN_AI_TOOL_NAME]).toBe("bash");
    expect(attributes["pi.tool.name"]).toBe("bash");
  });

  /** @scenario "Cache-write and reasoning tokens are lifted as their own token types" */
  it("gives cache-read, cache-write and reasoning tokens their own canonical keys", () => {
    const ctx = createExtractorContext(
      {
        "pi.ai.usage.input_tokens": 120,
        "pi.ai.usage.output_tokens": 30,
        "pi.ai.usage.cache_read_tokens": 400,
        "pi.ai.usage.cache_write_tokens": 90,
        "pi.ai.usage.reasoning_tokens": 55,
      },
      { name: "pi.ai.request" },
    );

    PiCanonicaliserService.create().apply(ctx);

    expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(400);
    expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]).toBe(90);
    expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS]).toBe(55);
    // Neither is folded into the output count, which pi reports on its own.
    expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBeUndefined();
  });

  /** @scenario "pi's reported cost survives beside the computed cost, never as it" */
  it("leaves pi's reported cost under pi's own key and on no cost key of ours", () => {
    const { attributes } = canonicaliseWholeChain({
      name: "pi.ai.request",
      spanAttributes: {
        "gen_ai.usage.input_tokens": 120,
        "gen_ai.usage.output_tokens": 30,
        "pi.ai.usage.cost": 0.0875,
        "pi.session.id": "s-1",
      },
    });

    expect(attributes["pi.ai.usage.cost"]).toBe(0.0875);
    expect(attributes[ATTR_KEYS.LANGWATCH_SPAN_COST]).toBeUndefined();
    // The log-lane cost vocabulary, which no span canonicaliser may write.
    expect(attributes["langwatch.cost.usd"]).toBeUndefined();
  });

  /** @scenario "pi's stop reason and error type are lifted onto the canonical span" */
  it("lifts pi's stop reason and error type as pi reported them", () => {
    const ctx = createExtractorContext(
      {
        "pi.ai.response.stop_reason": "max_tokens",
        "pi.ai.error.type": "overloaded_error",
      },
      { name: "pi.ai.request" },
    );

    PiCanonicaliserService.create().apply(ctx);

    expect(ctx.out[ATTR_KEYS.GEN_AI_RESPONSE_FINISH_REASONS]).toBe("max_tokens");
    expect(ctx.out[ATTR_KEYS.ERROR_TYPE]).toBe("overloaded_error");
  });

  /** @scenario "Session, turn and tool identifiers are lifted from pi's harness spans" */
  it("names the thread from pi.session.id and keeps pi's turn and tool-call ids", () => {
    const run = canonicaliseWholeChain({
      name: "pi.harness.run",
      spanAttributes: { "pi.session.id": "s-1" },
    });
    expect(run.attributes[ATTR_KEYS.LANGWATCH_THREAD_ID]).toBe("s-1");

    const turn = canonicaliseWholeChain({
      name: "pi.harness.turn",
      spanAttributes: { "pi.session.id": "s-1", "pi.turn.id": "t-7" },
    });
    expect(turn.attributes["pi.turn.id"]).toBe("t-7");
    // Copied, never consumed: the coding-agent fold reads pi's own key off the same span.
    expect(turn.attributes["pi.session.id"]).toBe("s-1");

    const tool = canonicaliseWholeChain({
      name: "pi.harness.tool",
      spanAttributes: { "pi.session.id": "s-1", "pi.tool.call_id": "call-3" },
    });
    expect(tool.attributes["pi.tool.call_id"]).toBe("call-3");
  });

  /** @scenario "A span with neither pi nor gen_ai attributes is left untouched" */
  it("lifts nothing from a span in an unrelated namespace", () => {
    const ctx = createExtractorContext(
      { "db.system": "postgresql", "db.statement": "select 1" },
      { name: "pg.query" },
    );

    PiCanonicaliserService.create().apply(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
  });

  it("does not claim a copilot or Claude Code span whose name merely contains pi", () => {
    const copilot = createExtractorContext(
      { "github.copilot.cost": "3" },
      { name: "chat gpt-5", instrumentationScope: { name: "github.copilot", version: null } },
    );
    PiCanonicaliserService.create().apply(copilot);
    expect(copilot.out).toEqual({});

    const claudeCode = createExtractorContext(
      { "session.id": "c-1" },
      {
        name: "claude_code.llm_request",
        instrumentationScope: { name: "com.anthropic.claude_code.events", version: null },
      },
    );
    PiCanonicaliserService.create().apply(claudeCode);
    expect(claudeCode.out).toEqual({});
  });
});
