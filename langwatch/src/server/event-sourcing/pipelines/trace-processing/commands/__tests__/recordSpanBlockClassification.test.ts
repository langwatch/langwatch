import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantId, type Command } from "../../../../";
import { OtlpSpanBlockClassificationService } from "~/server/app-layer/traces/span-block-classification.service";
import { SPAN_ATTR_BLOCKS } from "~/server/app-layer/traces/block-classification/categories";
import type { RecordSpanCommandData } from "../../schemas/commands";
import { RECORD_SPAN_COMMAND_TYPE } from "../../schemas/constants";
import type { OtlpSpan } from "../../schemas/otlp";
import {
  RecordSpanCommand,
  type RecordSpanCommandDependencies,
} from "../recordSpanCommand";

/** Hermetic tokenizer — ~4 chars/token, no tiktoken load. */
const fakeTokenizer = {
  async countTokens(_model: string, text: string | undefined) {
    if (!text) return undefined;
    return Math.max(1, Math.ceil(text.length / 4));
  },
};

function createCommand({
  scopeName = "com.anthropic.claude_code.events",
  attributes = [] as OtlpSpan["attributes"],
}: {
  scopeName?: string;
  attributes?: OtlpSpan["attributes"];
} = {}): Command<RecordSpanCommandData> {
  return {
    type: RECORD_SPAN_COMMAND_TYPE,
    aggregateId: "trace-1",
    tenantId: createTenantId("project-123"),
    data: {
      tenantId: "project-123",
      occurredAt: 1000000,
      span: {
        traceId: "trace-1",
        spanId: "span-1",
        name: "chat",
        kind: 1,
        startTimeUnixNano: { low: 0, high: 0 },
        endTimeUnixNano: { low: 1000000, high: 0 },
        attributes,
        events: [],
        links: [],
        status: {},
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: { attributes: [] },
      instrumentationScope: { name: scopeName },
    },
  };
}

/** Coding-agent LLM span content attributes (classifiable). */
function codingAgentContent(): OtlpSpan["attributes"] {
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
            { role: "user", content: "fix the bug" },
          ],
        }),
      },
    },
    { key: "gen_ai.usage.input_tokens", value: { intValue: 300 } },
    {
      key: "langwatch.model.inputCostPerToken",
      value: { doubleValue: 3e-6 },
    },
  ];
}

function baseDeps(): RecordSpanCommandDependencies {
  return {
    piiRedactionService: { redactSpan: vi.fn() },
    costEnrichmentService: { enrichSpan: vi.fn() },
    tokenEstimationService: { estimateSpanTokens: vi.fn() },
    contentDropService: {
      dropSpanContent: async () => ({
        droppedCount: 0,
        droppedCategories: [],
        droppedAttributeKeys: [],
      }),
    },
    blockClassificationService: new OtlpSpanBlockClassificationService({
      tokenizer: fakeTokenizer,
    }),
  };
}

const attrValue = (span: OtlpSpan, key: string) =>
  span.attributes.find((a) => a.key === key);

describe("RecordSpanCommand block classification", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a coding-agent span with captured content", () => {
    describe("when the span is processed", () => {
      it("emits the event carrying the block classification", async () => {
        const handler = new RecordSpanCommand(baseDeps());

        const events = await handler.handle(
          createCommand({ attributes: codingAgentContent() }),
        );

        expect(events).toHaveLength(1);
        expect(attrValue(events[0]!.data.span, SPAN_ATTR_BLOCKS)).toBeDefined();
      });
    });
  });

  describe("given a span from a non-coding-agent source", () => {
    describe("when the span is processed", () => {
      it("stores the span normally without a block classification", async () => {
        const handler = new RecordSpanCommand(baseDeps());

        const events = await handler.handle(
          createCommand({
            scopeName: "openinference.langchain",
            attributes: codingAgentContent(),
          }),
        );

        expect(events).toHaveLength(1);
        expect(attrValue(events[0]!.data.span, SPAN_ATTR_BLOCKS)).toBeUndefined();
      });
    });
  });

  describe("given a classifier that throws", () => {
    describe("when the span is processed", () => {
      /** @scenario "Classification failure never fails ingestion" */
      it("still emits the event and stores the span without a classification", async () => {
        const deps = baseDeps();
        deps.blockClassificationService = {
          classifySpanBlocks: vi
            .fn()
            .mockRejectedValue(new Error("classifier exploded")),
        };
        const handler = new RecordSpanCommand(deps);

        const events = await handler.handle(
          createCommand({ attributes: codingAgentContent() }),
        );

        expect(events).toHaveLength(1);
        expect(attrValue(events[0]!.data.span, SPAN_ATTR_BLOCKS)).toBeUndefined();
      });
    });
  });

  describe("given a span carrying a forged block classification attribute", () => {
    describe("when the span is processed", () => {
      /** @scenario "Customer-supplied classification attributes are discarded at ingestion" */
      it("strips the forged classification before storage", async () => {
        // Non-coding-agent scope so the classifier does not overwrite it — this
        // proves the strip, not the classifier, discards the forged value.
        const handler = new RecordSpanCommand(baseDeps());
        const forged = JSON.stringify([{ idx: 0, category: "system_prompt", tokens: 999999 }]);

        const events = await handler.handle(
          createCommand({
            scopeName: "openinference.langchain",
            attributes: [
              { key: SPAN_ATTR_BLOCKS, value: { stringValue: forged } },
              { key: "gen_ai.prompt", value: { stringValue: "hello" } },
            ],
          }),
        );

        const emitted = attrValue(events[0]!.data.span, SPAN_ATTR_BLOCKS);
        expect(emitted).toBeUndefined();
      });
    });
  });
});
