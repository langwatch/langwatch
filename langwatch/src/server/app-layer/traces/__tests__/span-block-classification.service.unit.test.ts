import { describe, expect, it } from "vitest";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  InputCategory,
  OutputCategory,
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

  describe("given a span whose output is a flat assistant string (codex / gen_ai.completion shape)", () => {
    it("classifies the flat output as assistant_text, not the output catch-all", async () => {
      // Codex sets langwatch.output to the reply TEXT (not a chat_messages
      // envelope), and the Claude Code converter emits it on gen_ai.completion —
      // neither parses as a message array. It must still classify as
      // assistant_text rather than dumping the whole output pool to other_output.
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
              value: [{ role: "user", content: "do the thing" }],
            }),
          },
        },
        {
          key: "langwatch.output",
          value: { stringValue: "I'm using the review skill." },
        },
        { key: "gen_ai.usage.input_tokens", value: { intValue: 100 } },
        { key: "gen_ai.usage.output_tokens", value: { intValue: 40 } },
        {
          key: "langwatch.model.inputCostPerToken",
          value: { doubleValue: 3e-6 },
        },
        {
          key: "langwatch.model.outputCostPerToken",
          value: { doubleValue: 1.5e-5 },
        },
      ]);

      await service.classifySpanBlocks({
        span,
        instrumentationScope: CLAUDE_SCOPE,
      });

      expect(
        attrValue(span, blockCategoryTokensAttr(OutputCategory.ASSISTANT_TEXT)),
      ).toBeDefined();
      expect(
        attrValue(span, blockCategoryTokensAttr(OutputCategory.OTHER_OUTPUT)),
      ).toBeUndefined();
    });
  });

  describe("given a coding-agent span carrying an explicit provider cost", () => {
    describe("when the span is classified", () => {
      it("reconciles per-category costs to the displayed cost_usd, not the registry estimate", async () => {
        // Claude Code stamps its own billed cost_usd onto langwatch.span.cost,
        // which computeSpanCost returns as the DISPLAYED cost (Priority 2) ahead
        // of the token×registry estimate. With no custom per-token rates and no
        // registry resolver, the rate estimate is 0 — so Σ per-category cost
        // must reconcile to the authoritative span cost, else it drifts from the
        // number the user sees.
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
          // Authoritative provider cost, no custom rates.
          { key: "langwatch.span.cost", value: { doubleValue: 0.1234 } },
        ]);

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
        expect(catCosts).toBeCloseTo(0.1234, 8);
      });

      it("still reconciles when a custom-rate attribute is present but non-numeric", async () => {
        // Regression: `hasCustomRates` must use the same coerced resolver the
        // pricing cascade uses. A malformed rate ("not-a-number") is NOT a real
        // custom rate — pricing falls through to the (absent) registry, so
        // reconciliation to the explicit cost_usd must still fire. The old raw
        // presence check saw the attribute, skipped reconciliation, and Σ read 0.
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
                value: [
                  { role: "system", content: "You are a coding assistant." },
                  { role: "user", content: "fix the failing test" },
                ],
              }),
            },
          },
          { key: "gen_ai.usage.input_tokens", value: { intValue: 300 } },
          { key: "langwatch.span.cost", value: { doubleValue: 0.1234 } },
          // Malformed custom rate — present, but not numeric-coercible.
          {
            key: "langwatch.model.inputCostPerToken",
            value: { stringValue: "not-a-number" },
          },
        ]);

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
        expect(catCosts).toBeCloseTo(0.1234, 8);
      });
    });
  });

  describe("given the kill switch is enabled", () => {
    describe("when a coding-agent span is classified", () => {
      it("produces no classification — the switch disables the feature", async () => {
        // Parity with OtlpSpanTokenEstimationService: a global (or per-project)
        // kill switch is the operable off-ramp for the live ingest path.
        const gated = new OtlpSpanBlockClassificationService({
          tokenizer: fakeTokenizer,
          featureFlagService: {
            isEnabled: async (key: string) =>
              key === "block-classification-killswitch",
          } as never,
        });
        const span = createSpan(codingAgentSpanAttributes());
        const before = span.attributes.length;

        await gated.classifySpanBlocks({
          span,
          instrumentationScope: CLAUDE_SCOPE,
        });

        expect(span.attributes.length).toBe(before);
        expect(attrValue(span, SPAN_ATTR_BLOCKS)).toBeUndefined();
      });

      it("disables classification for one project via the per-project switch", async () => {
        const gated = new OtlpSpanBlockClassificationService({
          tokenizer: fakeTokenizer,
          featureFlagService: {
            isEnabled: async (key: string, opts?: { projectId?: string }) =>
              key === "block-classification-project-killswitch" &&
              opts?.projectId === "proj-bad",
          } as never,
        });
        const span = createSpan(codingAgentSpanAttributes());
        const before = span.attributes.length;

        await gated.classifySpanBlocks({
          span,
          instrumentationScope: CLAUDE_SCOPE,
          tenantId: "proj-bad",
        });

        expect(span.attributes.length).toBe(before);
        expect(attrValue(span, SPAN_ATTR_BLOCKS)).toBeUndefined();
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
      it("bounds the per-block tokenizer input and keeps detail within the block cap", async () => {
        // Hot-path boundedness anchor for the ADR-033 invariant. Feeds the WORST
        // case our code owns — MAX_CLASSIFIED_BLOCKS_PER_SPAN blocks totalling
        // ~8 MiB — and asserts the two structural bounds that keep it safe: the
        // detail blob never exceeds the block cap, and the serialized payload
        // stays well under the attribute-value ceiling. A linear-cost tokenizer
        // (real per-character walk, not an O(1) fake) produces realistic token
        // counts for the allocation; wall-clock timing is deliberately NOT
        // asserted — it is machine-dependent and the structural caps are the
        // invariant that actually matters.
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
            return Promise.resolve(
              Math.max(tokens, Math.ceil(text.length / 4)),
            );
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

        await perfService.classifySpanBlocks({
          span,
          instrumentationScope: CLAUDE_SCOPE,
        });

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

  describe("given one adversarial multi-megabyte block", () => {
    describe("when the span is classified", () => {
      it("caps the tokenizer input per block and extrapolates the count", async () => {
        // Spool-reconstituted spans bypass the ingest value cap, so a single
        // giant block must never reach the tokenizer whole (DoS guard).
        let maxSeenChars = 0;
        const spyTokenizer = {
          countTokens: (_model: string, text: string | undefined) => {
            maxSeenChars = Math.max(maxSeenChars, text?.length ?? 0);
            return Promise.resolve(
              text ? Math.ceil(text.length / 4) : undefined,
            );
          },
        };
        const guardedService = new OtlpSpanBlockClassificationService({
          tokenizer: spyTokenizer,
        });

        const giant = "y".repeat(5 * 1024 * 1024); // 5 MiB single block
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
                value: [{ role: "user", content: giant }],
              }),
            },
          },
          {
            key: "gen_ai.usage.input_tokens",
            value: { intValue: 1_000_000 },
          },
          {
            key: "langwatch.model.inputCostPerToken",
            value: { doubleValue: 3e-6 },
          },
        ]);

        await guardedService.classifySpanBlocks({
          span,
          instrumentationScope: CLAUDE_SCOPE,
        });

        expect(maxSeenChars).toBeLessThanOrEqual(64_000);
        // Conservation still holds: the pool total is provider truth.
        const detail = JSON.parse(
          attrValue(span, SPAN_ATTR_BLOCKS)!.value.stringValue!,
        ) as Array<{ tokens: number }>;
        const totalTokens = detail.reduce((sum, b) => sum + b.tokens, 0);
        expect(totalTokens).toBe(1_000_000);
      });
    });
  });
});
