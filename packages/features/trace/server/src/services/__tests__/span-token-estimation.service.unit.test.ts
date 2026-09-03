import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { TraceTokenCounterPort } from "../../ports/trace-token-counter.port";
import { OtlpSpanTokenEstimationService } from "../span-token-estimation.service";

class CountingTokenizer extends TraceTokenCounterPort {
  readonly calls: { model: string; text: string | undefined }[] = [];

  constructor(private readonly answer: number | undefined) {
    super();
  }

  async tryCountTokens(model: string, text: string | undefined): Promise<number | undefined> {
    this.calls.push({ model, text });
    return this.answer;
  }
}

function flags(enabled: Record<string, boolean> = {}): FeatureFlagService {
  return { isEnabled: async (key: string) => enabled[key] ?? false } as never;
}

function span(attributes: OtlpSpan["attributes"]): OtlpSpan {
  return { attributes } as OtlpSpan;
}

const llm = { key: "langwatch.span.type", value: { stringValue: "llm" } };
const model = { key: "gen_ai.response.model", value: { stringValue: "openai/gpt-5-mini" } };
const input = { key: "langwatch.input", value: { stringValue: '{"type":"text","value":"hi"}' } };
const output = {
  key: "langwatch.output",
  value: { stringValue: '{"type":"text","value":"there"}' },
};

describe("OtlpSpanTokenEstimationService", () => {
  const estimate = async (
    subject: OtlpSpan,
    tokenizer: CountingTokenizer,
    featureFlags: FeatureFlagService = flags(),
  ): Promise<void> => {
    await OtlpSpanTokenEstimationService.create({ tokenizer, featureFlags }).estimateSpanTokens({
      span: subject,
      tenantId: "project-1",
    });
  };

  describe("given a span that is not an LLM span", () => {
    describe("when the estimator runs", () => {
      /** @scenario "Only an LLM span is estimated" */
      it("leaves the span exactly as it arrived", async () => {
        const tokenizer = new CountingTokenizer(7);
        const subject = span([model, input, output]);

        await estimate(subject, tokenizer);

        expect(tokenizer.calls).toHaveLength(0);
        expect(subject.attributes).toHaveLength(3);
      });
    });
  });

  describe("given an LLM span that already reports both counts", () => {
    describe("when the estimator runs", () => {
      /** @scenario "A span that already reports both counts is left alone" */
      it("makes no tokenizer call", async () => {
        const tokenizer = new CountingTokenizer(7);

        await estimate(
          span([
            llm,
            model,
            input,
            output,
            { key: "gen_ai.usage.input_tokens", value: { intValue: 3 } },
            { key: "gen_ai.usage.output_tokens", value: { intValue: 4 } },
          ]),
          tokenizer,
        );

        expect(tokenizer.calls).toHaveLength(0);
      });
    });
  });

  describe("given an LLM span reporting only input tokens", () => {
    describe("when the estimator runs", () => {
      /** @scenario "Only the missing side is estimated" */
      it("adds only the output count", async () => {
        const tokenizer = new CountingTokenizer(7);
        const subject = span([
          llm,
          model,
          input,
          output,
          { key: "gen_ai.usage.input_tokens", value: { intValue: 3 } },
        ]);

        await estimate(subject, tokenizer);

        // The provider prefix is stripped by the tokenizer transport, not here.
        expect(tokenizer.calls).toEqual([{ model: "openai/gpt-5-mini", text: "there" }]);
        expect(subject.attributes).toContainEqual({
          key: "gen_ai.usage.output_tokens",
          value: { intValue: 7 },
        });
        expect(
          subject.attributes.filter((a) => a.key === "gen_ai.usage.input_tokens"),
        ).toHaveLength(1);
      });
    });
  });

  describe("given an LLM span with text and no counts", () => {
    describe("when the estimator adds counts", () => {
      /** @scenario "An estimated span is marked as estimated" */
      it("marks the span as estimated", async () => {
        const subject = span([llm, model, input, output]);

        await estimate(subject, new CountingTokenizer(7));

        expect(subject.attributes).toContainEqual({
          key: "langwatch.tokens.estimated",
          value: { boolValue: true },
        });
      });
    });

    describe("when the tokenizer cannot count", () => {
      /** @scenario "A tokenizer that cannot count leaves the span untouched" */
      it("adds nothing at all", async () => {
        const subject = span([llm, model, input, output]);

        await estimate(subject, new CountingTokenizer(void 0));

        expect(subject.attributes).toHaveLength(4);
      });
    });
  });

  describe("given a kill switch is on", () => {
    describe("when the global switch is on", () => {
      /** @scenario "Either kill switch stops estimation" */
      it("makes no tokenizer call", async () => {
        const tokenizer = new CountingTokenizer(7);

        await estimate(
          span([llm, model, input, output]),
          tokenizer,
          flags({ "token-estimation-killswitch": true }),
        );

        expect(tokenizer.calls).toHaveLength(0);
      });
    });

    describe("when only the per-project switch is on", () => {
      /** @scenario "Either kill switch stops estimation" */
      it("still makes no tokenizer call, and consults the project scope", async () => {
        const tokenizer = new CountingTokenizer(7);
        const isEnabled = vi.fn(
          async (key: string) => key === "token-estimation-project-killswitch",
        );

        await estimate(span([llm, model, input, output]), tokenizer, {
          isEnabled,
        } as never);

        expect(tokenizer.calls).toHaveLength(0);
        expect(isEnabled).toHaveBeenCalledWith("token-estimation-project-killswitch", {
          kind: "project",
          projectId: "project-1",
        });
      });
    });
  });
});
