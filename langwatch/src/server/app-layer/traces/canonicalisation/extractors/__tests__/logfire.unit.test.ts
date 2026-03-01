import { describe, expect, it, vi } from "vitest";

import type { NormalizedAttributes } from "../../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { SpanDataBag } from "../../spanDataBag";
import { ATTR_KEYS } from "../_constants";
import type { ExtractorContext } from "../_types";
import { LogfireExtractor } from "../logfire";
import { createExtractorContext, parseJsonStringAttrs } from "./_testHelpers";

function createLogfireContext(
  attrs: Record<string, unknown>,
  events: Array<{ name: string; attributes: Record<string, unknown> }> = [],
): ExtractorContext {
  const normalizedEvents = events.map((e) => ({
    name: e.name,
    attributes: e.attributes as NormalizedAttributes,
    timeUnixMs: 0,
  }));

  const parsed = parseJsonStringAttrs(attrs);
  const bag = new SpanDataBag(
    parsed as NormalizedAttributes,
    normalizedEvents,
  );
  const out: NormalizedAttributes = {};

  const setAttr = vi.fn((key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    out[key] = value;
  });

  const setAttrIfAbsent = vi.fn((key: string, value: unknown) => {
    if (!(key in out)) {
      if (value === null || value === undefined) return;
      out[key] = value;
    }
  });

  const recordRule = vi.fn();

  const span: ExtractorContext["span"] = {
    name: "test",
    kind: 0,
    instrumentationScope: { name: "logfire", version: null },
    statusMessage: null,
    statusCode: null,
  };

  return { bag, out, span, recordRule, setAttr, setAttrIfAbsent };
}

describe("LogfireExtractor", () => {
  const extractor = new LogfireExtractor();

  describe("when raw_input is present", () => {
    it("maps to gen_ai.input.messages", () => {
      const messages = [{ role: "user", content: "Hello" }];
      const ctx = createLogfireContext({
        [ATTR_KEYS.RAW_INPUT]: JSON.stringify(messages),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_INPUT_MESSAGES]).toEqual(messages);
    });

    it("infers span type as llm when raw_input is still in bag", () => {
      // When gen_ai.input.messages is already set (e.g. by another extractor),
      // extractInputMessages skips and raw_input stays in the bag,
      // allowing span type inference.
      const ctx = createLogfireContext({
        [ATTR_KEYS.RAW_INPUT]: JSON.stringify([
          { role: "user", content: "Hello" },
        ]),
        [ATTR_KEYS.GEN_AI_INPUT_MESSAGES]: JSON.stringify([
          { role: "user", content: "existing" },
        ]),
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });
  });

  describe("when gen_ai.choice events are present", () => {
    it("extracts message/content/text from events as output messages", () => {
      const ctx = createLogfireContext(
        {},
        [
          {
            name: "gen_ai.choice",
            attributes: { message: JSON.stringify({ role: "assistant", content: "Hi there" }) },
          },
        ],
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: { role: "assistant", content: "Hi there" } },
      ]);
    });
  });

  describe("when neither raw_input nor gen_ai.choice events exist", () => {
    it("does nothing", () => {
      const ctx = createExtractorContext({});

      extractor.apply(ctx);

      expect(ctx.setAttr).not.toHaveBeenCalled();
    });
  });
});
