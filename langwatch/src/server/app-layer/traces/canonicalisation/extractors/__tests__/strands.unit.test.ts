import { describe, expect, it } from "vitest";

import { vi } from "vitest";
import type { NormalizedAttributes } from "../../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { SpanDataBag } from "../../spanDataBag";
import { toAttrValue } from "../../utils";
import { ATTR_KEYS } from "../_constants";
import type { ExtractorContext } from "../_types";
import { StrandsExtractor } from "../strands";
import { createExtractorContext } from "./_testHelpers";

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
    attributes: e.attributes as NormalizedAttributes,
    timeUnixMs: 0,
  }));

  const bag = new SpanDataBag(
    attrs as NormalizedAttributes,
    normalizedEvents,
  );
  const out: NormalizedAttributes = {};

  const setAttr = vi.fn((key: string, value: unknown) => {
    const av = toAttrValue(value);
    if (av === null) return;
    out[key] = av;
  });

  const setAttrIfAbsent = vi.fn((key: string, value: unknown) => {
    if (!(key in out)) {
      const av = toAttrValue(value);
      if (av === null) return;
      out[key] = av;
    }
  });

  const recordRule = vi.fn();

  const span: ExtractorContext["span"] = {
    name: "test",
    kind: 0,
    instrumentationScope: { name: "strands.telemetry.tracer", version: null },
    statusMessage: null,
    statusCode: null,
    ...spanOverrides,
  };

  return { bag, out, span, recordRule, setAttr, setAttrIfAbsent };
}

describe("StrandsExtractor", () => {
  const extractor = new StrandsExtractor();

  describe("when Strands detection matches", () => {
    it("detects via instrumentationScope.name = strands.telemetry.tracer", () => {
      const ctx = createStrandsContext(
        { [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "chat" },
        [],
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });

    it("detects via gen_ai.system = strands-agents", () => {
      const ctx = createStrandsContext(
        {
          [ATTR_KEYS.GEN_AI_SYSTEM]: "strands-agents",
          [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "chat",
        },
        [],
        { instrumentationScope: { name: "other", version: null } },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });
  });

  describe("when gen_ai.operation.name maps to span type", () => {
    it("maps chat to llm", () => {
      const ctx = createStrandsContext(
        { [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "chat" },
        [],
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });

    it("maps execute_tool to tool", () => {
      const ctx = createStrandsContext(
        { [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "execute_tool" },
        [],
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("tool");
    });

    it("maps invoke_agent to agent", () => {
      const ctx = createStrandsContext(
        { [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "invoke_agent" },
        [],
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("agent");
    });
  });

  describe("when role-based events are present", () => {
    it("extracts gen_ai.user.message events as input messages", () => {
      const ctx = createStrandsContext({}, [
        {
          name: "gen_ai.user.message",
          attributes: { content: "Hello from user" },
        },
      ]);

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual(
        JSON.stringify([{ role: "user", content: "Hello from user" }]),
      );
    });

    it("extracts gen_ai.system.message events as input messages", () => {
      const ctx = createStrandsContext({}, [
        {
          name: "gen_ai.system.message",
          attributes: { content: "System prompt" },
        },
      ]);

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual(
        JSON.stringify([{ role: "system", content: "System prompt" }]),
      );
    });

    it("extracts multiple role events in order", () => {
      const ctx = createStrandsContext({}, [
        {
          name: "gen_ai.system.message",
          attributes: { content: "Be helpful" },
        },
        {
          name: "gen_ai.user.message",
          attributes: { content: "Hi" },
        },
      ]);

      extractor.apply(ctx);

      const messages = JSON.parse(
        ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES] as string,
      ) as unknown[];
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: "system", content: "Be helpful" });
      expect(messages[1]).toEqual({ role: "user", content: "Hi" });
    });
  });

  describe("when gen_ai.choice events are present", () => {
    it("extracts output messages from events", () => {
      const ctx = createStrandsContext({}, [
        {
          name: "gen_ai.choice",
          attributes: { content: "Response text" },
        },
      ]);

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual(
        JSON.stringify([
          { role: "assistant", content: "Response text" },
        ]),
      );
    });
  });

  describe("when NOT a Strands span", () => {
    it("does nothing", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.GEN_AI_OPERATION_NAME]: "chat" },
        { instrumentationScope: { name: "opentelemetry", version: null } },
      );

      extractor.apply(ctx);

      expect(ctx.setAttr).not.toHaveBeenCalled();
    });
  });
});
