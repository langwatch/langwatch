import { describe, expect, it, vi } from "vitest";
import type { CanonicalAttributes } from "@langwatch/trace-contract";
import { CanonicalSpanStore } from "../../canonical-attributes.service.ts";
import { ATTR_KEYS } from "@langwatch/trace-contract";
import type { ExtractorContext } from "../../canonical-attributes.service.ts";
import { StrandsCanonicaliserService } from "../strands-canonicaliser.service.ts";
import { createExtractorContext } from "../../__tests__/test-helpers.ts";

/**
 * Creates a context with events support for Strands tests.
 * Strands relies heavily on events, so we need a custom helper.
 */
function createStrandsContext(
  attrs: Record<string, unknown>,
  events: Array<{ name: string; attributes: Record<string, unknown> }>,
  spanOverrides?: Partial<ExtractorContext["span"]>,
): ExtractorContext {
  const normalizedEvents = events.map((e) => ({
    name: e.name,
    attributes: e.attributes as CanonicalAttributes,
    timeUnixMs: 0,
  }));

  const bag = CanonicalSpanStore.create({
    spanAttributes: attrs as CanonicalAttributes,
    events: normalizedEvents,
  });
  const out: CanonicalAttributes = {};

  // Mirrors `TraceCanonicalisationService`: production guards null/undefined and
  // stores the value as it was given. This double used to coerce through
  // `toAttrValue`, JSON-stringifying objects — a step production has never had.
  const setAttr = vi.fn((key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    out[key] = value as CanonicalAttributes[string];
  });

  const setAttrIfAbsent = vi.fn((key: string, value: unknown) => {
    if (key in out) return;
    setAttr(key, value);
  });

  const recordRule = vi.fn();

  const span: ExtractorContext["span"] = {
    name: "test",
    kind: 0,
    instrumentationScope: { name: "strands.telemetry.tracer", version: null },
    statusMessage: null,
    statusCode: null,
    parentSpanId: "abc123",
    ...spanOverrides,
  };

  return { bag, out, span, recordRule, setAttr, setAttrIfAbsent };
}

describe("StrandsCanonicaliserService", () => {
  const extractor = StrandsCanonicaliserService.create();

  describe("given a span carrying one Strands detection signal", () => {
    /** @scenario 'A span is recognised as Strands by any of its detection signals' */
    it.each([
      [
        "instrumentationScope.name = strands.telemetry.tracer",
        { instrumentationScope: { name: "strands.telemetry.tracer", version: null } },
        {},
      ],
      [
        "instrumentationScope.name = opentelemetry.instrumentation.strands",
        { instrumentationScope: { name: "opentelemetry.instrumentation.strands", version: null } },
        {},
      ],
      [
        "gen_ai.system = strands-agents",
        { instrumentationScope: { name: "other", version: null } },
        { [ATTR_KEYS.GEN_AI_SYSTEM]: "strands-agents" },
      ],
      [
        "system.name = strands-agents",
        { instrumentationScope: { name: "other", version: null } },
        { [ATTR_KEYS.SYSTEM_NAME]: "strands-agents" },
      ],
      [
        "service.name = strands-agents",
        { instrumentationScope: { name: "other", version: null } },
        { [ATTR_KEYS.SERVICE_NAME]: "strands-agents" },
      ],
      [
        "gen_ai.agent.name = Strands Agents",
        { instrumentationScope: { name: "other", version: null } },
        { [ATTR_KEYS.GEN_AI_AGENT_NAME]: "Strands Agents" },
      ],
    ])("when apply runs, it recognises the span via %s", (_label, spanOverrides, extraAttrs) => {
      const ctx = createStrandsContext(
        { [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "chat", ...extraAttrs },
        [],
        spanOverrides,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });
  });

  describe("given a span with none of the Strands detection signals", () => {
    /** @scenario "A span with none of Strands' detection signals is left untouched" */
    it("when apply runs, it does not canonicalise the span", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "chat" },
        { instrumentationScope: { name: "opentelemetry", version: null } },
      );

      extractor.apply(ctx);

      expect(ctx.setAttr).not.toHaveBeenCalled();
    });
  });

  describe("given gen_ai.operation.name on a detected span", () => {
    /** @scenario 'A known operation name maps to its canonical span type' */
    it.each([
      ["chat", "llm"],
      ["execute_tool", "tool"],
      ["invoke_agent", "agent"],
    ])("when apply runs, it maps operation %s to span type %s", (operation, expectedSpanType) => {
      const ctx = createStrandsContext({ [ATTR_KEYS.GEN_AI_OPERATION_NAME]: operation }, []);

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe(expectedSpanType);
    });

    /** @scenario 'An unrecognised operation name is dropped rather than guessed at' */
    it("when apply runs, it leaves the span type unset for an unmapped operation name", () => {
      const ctx = createStrandsContext({ [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "something_else" }, []);

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBeUndefined();
    });
  });

  describe("given role-named events describing the input conversation", () => {
    /** @scenario 'Role-named events become an ordered input-message list' */
    it("when apply runs, it preserves conversation order across interleaved roles", () => {
      const ctx = createStrandsContext({}, [
        { name: "gen_ai.user.message", attributes: { content: "First question" } },
        { name: "gen_ai.assistant.message", attributes: { content: "First answer" } },
        { name: "gen_ai.user.message", attributes: { content: "Follow-up question" } },
      ]);

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual([
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Follow-up question" },
      ]);
    });

    /** @scenario 'A system-role event is promoted to the system instruction and dropped from input' */
    it.each([
      [
        "the system event is first",
        [
          { name: "gen_ai.system.message", attributes: { content: "Be helpful" } },
          { name: "gen_ai.user.message", attributes: { content: "Hi" } },
        ],
      ],
      [
        "the system event is not first",
        [
          { name: "gen_ai.user.message", attributes: { content: "Hi" } },
          { name: "gen_ai.system.message", attributes: { content: "Be helpful" } },
        ],
      ],
    ])(
      "when %s, it lifts the system message out and keeps only chat messages",
      (_label, events) => {
        const ctx = createStrandsContext({}, events);

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.GEN_AI_SYSTEM_INSTRUCTIONS]).toBe("Be helpful");
        const messages = ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] as unknown[];
        expect(messages).toEqual([{ role: "user", content: "Hi" }]);
      },
    );

    /** @scenario 'An input-messages attribute already present upstream is never overwritten' */
    it("when gen_ai.input.messages is already present, it skips extraction from events", () => {
      const preset = [{ role: "user", content: "already there" }];
      const ctx = createStrandsContext({ [ATTR_KEYS.GEN_AI_INPUT_MESSAGES]: preset }, [
        { name: "gen_ai.user.message", attributes: { content: "new message" } },
      ]);

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
    });
  });

  describe("given gen_ai.choice events describing the output", () => {
    /** @scenario 'Choice events become output messages, defaulting role to assistant' */
    it("when a choice event carries no role, it defaults the output message role to assistant", () => {
      const ctx = createStrandsContext({}, [
        {
          name: "gen_ai.choice",
          attributes: { content: "Response text", finish_reason: "end_turn" },
        },
      ]);

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: "Response text", finish_reason: "end_turn" },
      ]);
    });

    it("when a choice event carries a role, it preserves that role instead of the assistant default", () => {
      const ctx = createStrandsContext({}, [
        { name: "gen_ai.choice", attributes: { content: "Response", role: "customrole" } },
      ]);

      extractor.apply(ctx);

      const [message] = ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES] as Array<{ role: string }>;
      expect(message?.role).toBe("customrole");
    });
  });

  describe("given content spread across Strands' several event-attribute names", () => {
    /** @scenario 'Content is read from the first candidate attribute present, in a fixed order' */
    it.each([
      ["content", { content: "from content" }, "from content"],
      ["gen_ai.content", { "gen_ai.content": "from gen_ai.content" }, "from gen_ai.content"],
      ["message", { message: "from message" }, "from message"],
      ["text", { text: "from text" }, "from text"],
      [
        "gen_ai.prompt.content",
        { "gen_ai.prompt.content": "from prompt.content" },
        "from prompt.content",
      ],
    ])("when only %s is present, it extracts content from it", (_label, eventAttrs, expected) => {
      const ctx = createStrandsContext({}, [
        { name: "gen_ai.user.message", attributes: eventAttrs },
      ]);

      extractor.apply(ctx);

      const [message] = ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] as Array<{ content: unknown }>;
      expect(message?.content).toBe(expected);
    });

    it("when both content and text are present, it prefers content", () => {
      const ctx = createStrandsContext({}, [
        {
          name: "gen_ai.user.message",
          attributes: { content: "preferred", text: "should not be used" },
        },
      ]);

      extractor.apply(ctx);

      const [message] = ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] as Array<{ content: unknown }>;
      expect(message?.content).toBe("preferred");
    });
  });

  describe("given the model attribute recorded on a detected span", () => {
    /** @scenario 'A recorded model marks the span as matched' */
    it.each([
      ["gen_ai.request.model", { [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: "claude-x" }, true],
      [
        "gen_ai.response.model as a fallback",
        { [ATTR_KEYS.GEN_AI_RESPONSE_MODEL]: "claude-x" },
        true,
      ],
      ["no model attribute at all", {}, false],
    ])("when the span carries %s, matched=%s", (_label, modelAttrs, expectMatched) => {
      const ctx = createStrandsContext(
        { [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "chat", ...modelAttrs },
        [],
      );

      extractor.apply(ctx);

      const recordRule = ctx.recordRule as ReturnType<typeof vi.fn>;
      const recorded = recordRule.mock.calls.some((call) => call[0] === "strands:matched");
      expect(recorded).toBe(expectMatched);
    });
  });

  describe("given span metadata unrelated to gen_ai attributes", () => {
    /** @scenario 'Canonicalisation never touches span linkage fields' */
    it("when apply runs, it leaves parentSpanId untouched", () => {
      const ctx = createStrandsContext({ [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "chat" }, [], {
        parentSpanId: "parent-xyz",
      });

      extractor.apply(ctx);

      expect(ctx.span.parentSpanId).toBe("parent-xyz");
    });
  });
});
