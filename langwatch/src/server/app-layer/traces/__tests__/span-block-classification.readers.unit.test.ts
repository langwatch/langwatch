import { describe, expect, it } from "vitest";

import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { extractUsagePools } from "../span-block-classification.readers";

type Attr = OtlpSpan["attributes"][number];

function createSpan(attributes: Attr[]): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "chat",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1000, high: 0 },
    attributes,
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function usageAttrs({
  input,
  cached,
}: {
  input: number;
  cached: number;
}): Attr[] {
  return [
    { key: "gen_ai.usage.input_tokens", value: { intValue: input } },
    { key: "gen_ai.usage.cached_tokens", value: { intValue: cached } },
    { key: "gen_ai.usage.output_tokens", value: { intValue: 50 } },
  ];
}

describe("extractUsagePools", () => {
  describe("when the harness is codex (OpenAI usage convention)", () => {
    // OpenAI reports cached tokens as a SUBSET of input_tokens; the pools
    // must be exclusive or input-axis allocation double-counts the cached
    // prefix (same convention split as sumStepContext).
    it("subtracts the cached subset out of the fresh input pool", () => {
      const pools = extractUsagePools(
        createSpan(usageAttrs({ input: 1000, cached: 900 })),
        "codex",
      );
      expect(pools.inputTokens).toBe(100);
      expect(pools.cacheReadTokens).toBe(900);
    });

    it("floors the fresh pool at zero when cached exceeds input", () => {
      const pools = extractUsagePools(
        createSpan(usageAttrs({ input: 100, cached: 150 })),
        "codex",
      );
      expect(pools.inputTokens).toBe(0);
    });
  });

  describe("when the harness is claude (Anthropic exclusive pools)", () => {
    it("keeps the reported pools disjoint as-is", () => {
      const pools = extractUsagePools(
        createSpan([
          { key: "gen_ai.usage.input_tokens", value: { intValue: 50 } },
          {
            key: "gen_ai.usage.cache_read.input_tokens",
            value: { intValue: 900 },
          },
          {
            key: "gen_ai.usage.cache_creation.input_tokens",
            value: { intValue: 100 },
          },
          { key: "gen_ai.usage.output_tokens", value: { intValue: 20 } },
        ]),
        "claude",
      );
      expect(pools.inputTokens).toBe(50);
      expect(pools.cacheReadTokens).toBe(900);
      expect(pools.cacheCreationTokens).toBe(100);
      expect(pools.outputTokens).toBe(20);
    });
  });
});
