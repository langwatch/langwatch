import { describe, expect, it } from "vitest";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  InputCategory,
  SPAN_ATTR_BLOCKS,
  SPAN_ATTR_CLASSIFIER_VERSION,
} from "../block-classification/categories";
import { OtlpSpanBlockClassificationService } from "../span-block-classification.service";

/** Deterministic, hermetic tokenizer — ~4 chars/token, no tiktoken load. */
const fakeTokenizer = {
  async countTokens(_model: string, text: string | undefined) {
    if (!text) return undefined;
    return Math.max(1, Math.ceil(text.length / 4));
  },
};

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

const CLAUDE_SCOPE = { name: "com.anthropic.claude_code.events" };

/** A representative coding-agent LLM span: system + fresh user input, provider
 * usage tokens, and custom per-tier rates (so the price registry is not hit). */
function codingAgentSpanAttributes(): Attr[] {
  return [
    { key: "langwatch.span.type", value: { stringValue: "llm" } },
    { key: "gen_ai.request.model", value: { stringValue: "claude-sonnet-4" } },
    {
      key: "langwatch.input",
      value: {
        stringValue: JSON.stringify({
          type: "chat_messages",
          value: [
            { role: "system", content: "You are a coding assistant." },
            { role: "user", content: "fix the failing test" },
          ],
        }),
      },
    },
    {
      key: "langwatch.output",
      value: {
        stringValue: JSON.stringify([
          { role: "assistant", content: "Here is the fix." },
        ]),
      },
    },
    { key: "gen_ai.usage.input_tokens", value: { intValue: 300 } },
    { key: "gen_ai.usage.output_tokens", value: { intValue: 20 } },
    {
      key: "langwatch.model.inputCostPerToken",
      value: { doubleValue: 3e-6 },
    },
    {
      key: "langwatch.model.outputCostPerToken",
      value: { doubleValue: 1.5e-5 },
    },
  ];
}

const service = new OtlpSpanBlockClassificationService({
  tokenizer: fakeTokenizer,
});

const attrValue = (span: OtlpSpan, key: string): Attr | undefined =>
  span.attributes.find((a) => a.key === key);

describe("OtlpSpanBlockClassificationService", () => {
  describe("given a coding-agent span with captured content", () => {
    describe("when the span is classified", () => {
      it("pushes block classification, version, and per-category totals", async () => {
        const span = createSpan(codingAgentSpanAttributes());

        await service.classifySpanBlocks({
          span,
          instrumentationScope: CLAUDE_SCOPE,
        });

        expect(attrValue(span, SPAN_ATTR_BLOCKS)).toBeDefined();
        expect(
          attrValue(span, SPAN_ATTR_CLASSIFIER_VERSION)?.value.intValue,
        ).toBe(1);
        // System prompt is a real category with nonzero allocation.
        expect(
          attrValue(span, blockCategoryTokensAttr(InputCategory.SYSTEM_PROMPT)),
        ).toBeDefined();
        expect(
          attrValue(span, blockCategoryCostAttr(InputCategory.SYSTEM_PROMPT)),
        ).toBeDefined();
      });

      it("conserves cost — per-category costs sum to the span's real cost", async () => {
        const span = createSpan(codingAgentSpanAttributes());

        await service.classifySpanBlocks({
          span,
          instrumentationScope: CLAUDE_SCOPE,
        });

        const catCosts = span.attributes
          .filter(
            (a) =>
              a.key.startsWith("langwatch.reserved.blockcat.") &&
              a.key.endsWith(".cost_usd"),
          )
          .reduce((n, a) => n + Number(a.value.stringValue), 0);
        // input 300 * 3e-6 + output 20 * 1.5e-5
        const realCost = 300 * 3e-6 + 20 * 1.5e-5;
        expect(Math.abs(catCosts - realCost)).toBeLessThan(1e-9);
      });
    });
  });

  describe("given a span that is not coding-agent traffic", () => {
    describe("when the span is processed", () => {
      /** @scenario "A span from a non-coding-agent source is not classified" */
      it("does not classify it", async () => {
        const span = createSpan(codingAgentSpanAttributes());
        const before = span.attributes.length;

        await service.classifySpanBlocks({
          span,
          instrumentationScope: { name: "openinference.langchain" },
        });

        expect(span.attributes.length).toBe(before);
        expect(attrValue(span, SPAN_ATTR_BLOCKS)).toBeUndefined();
      });
    });
  });

  describe("given a coding-agent span without captured content", () => {
    describe("when the span is processed", () => {
      /** @scenario "A span without captured content is skipped silently" */
      it("carries no block classification and surfaces no error", async () => {
        const span = createSpan([
          { key: "langwatch.span.type", value: { stringValue: "llm" } },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "claude-sonnet-4" },
          },
          { key: "gen_ai.usage.input_tokens", value: { intValue: 300 } },
        ]);
        const before = span.attributes.length;

        await expect(
          service.classifySpanBlocks({
            span,
            instrumentationScope: CLAUDE_SCOPE,
          }),
        ).resolves.toBeUndefined();

        expect(span.attributes.length).toBe(before);
        expect(attrValue(span, SPAN_ATTR_BLOCKS)).toBeUndefined();
      });
    });
  });

  describe("given a span whose input content is ~8 MiB at the block cap", () => {
    describe("when the span is classified", () => {
      it("completes within the hot-path budget and keeps detail within the block cap", async () => {
        // Perf anchor for the ADR-033 hot-path invariant. Exercises the WORST
        // case our code owns: MAX_CLASSIFIED_BLOCKS_PER_SPAN blocks totalling
        // ~8 MiB, with a tokenizer whose cost is LINEAR in text length (a real
        // per-character walk, not O(1)) so the O(blocks × bytes) shape of the
        // service is genuinely paid. Real tiktoken is deliberately not used
        // here: its encoder loads over fs/network (flake in unit CI), and the
        // production hot path already pays equivalent full-text tokenization
        // in OtlpSpanTokenEstimationService for spans missing usage — the cost
        // class this test bounds is the same.
        const linearCostTokenizer = {
          countTokens: (_model: string, text: string | undefined) => {
            if (!text) return Promise.resolve(undefined);
            let tokens = 0;
            let inWord = false;
            for (let i = 0; i < text.length; i++) {
              const ws = text.charCodeAt(i) <= 32;
              if (!ws && !inWord) tokens++;
              inWord = !ws;
            }
            return Promise.resolve(Math.max(tokens, Math.ceil(text.length / 4)));
          },
        };
        const perfService = new OtlpSpanBlockClassificationService({
          tokenizer: linearCostTokenizer,
        });

        // 512 word-shaped blocks totalling ~8 MiB (the cap boundary), plus
        // overflow blocks that must lump into the catch-all.
        const chunk = "lorem ipsum dolor sit amet ".repeat(600); // ~16 KiB
        const messages = [
          { role: "system", content: "You are a coding assistant." },
          ...Array.from({ length: 520 }, () => ({
            role: "user",
            content: chunk,
          })),
        ];
        const span = createSpan([
          { key: "langwatch.span.type", value: { stringValue: "llm" } },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "claude-sonnet-4" },
          },
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify({
                type: "chat_messages",
                value: messages,
              }),
            },
          },
          { key: "gen_ai.usage.input_tokens", value: { intValue: 2_000_000 } },
          {
            key: "langwatch.model.inputCostPerToken",
            value: { doubleValue: 3e-6 },
          },
        ]);

        const start = Date.now();
        await perfService.classifySpanBlocks({
          span,
          instrumentationScope: CLAUDE_SCOPE,
        });
        const elapsedMs = Date.now() - start;

        expect(elapsedMs).toBeLessThan(5000);
        const detail = JSON.parse(
          attrValue(span, SPAN_ATTR_BLOCKS)!.value.stringValue!,
        ) as unknown[];
        expect(detail.length).toBeLessThanOrEqual(512);
        // The classification attribute payload itself must stay bounded — it
        // bypasses the ingest value cap (which runs earlier) by design.
        const blobBytes = attrValue(span, SPAN_ATTR_BLOCKS)!.value.stringValue!
          .length;
        expect(blobBytes).toBeLessThan(256 * 1024);
      });
    });
  });
});
