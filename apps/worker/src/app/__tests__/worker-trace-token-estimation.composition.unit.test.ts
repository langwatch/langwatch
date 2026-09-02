import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { TraceTokenCounterPort } from "@langwatch/trace-server";
import { describe, expect, it } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import { WorkerTiktokenCounterAdapter } from "../../platform/infrastructure/worker-token-counter.adapter";
import { createWorkerTraceTokenEstimation } from "../worker-trace-token-estimation.composition";

/**
 * Spec: packages/features/trace/specs/span-token-estimation.feature
 *
 * A COMPOSITION-CAPABILITY test. Trace has not converted, so nothing in this
 * process estimates a token. What has to be true today is that this
 * composition root can build the whole path — Trace's narrow port, the
 * estimator, the kill switches and the encoding tables — out of the two
 * tokenizer variables and the feature-flag service this process already holds.
 *
 * It is driven through `TraceSpanTokenEstimationPort`, the port the conversion
 * will call, rather than through the service underneath it.
 */

const flags = (enabled: Record<string, boolean> = {}): FeatureFlagService =>
  ({ isEnabled: async (key: string) => enabled[key] ?? false }) as never;

class FixedTokenizer extends TraceTokenCounterPort {
  readonly calls: string[] = [];

  async tryCountTokens(model: string, text: string | undefined): Promise<number | undefined> {
    this.calls.push(`${model}:${text ?? ""}`);
    return 11;
  }
}

const llmSpan = (): OtlpSpan =>
  ({
    attributes: [
      { key: "langwatch.span.type", value: { stringValue: "llm" } },
      { key: "gen_ai.response.model", value: { stringValue: "gpt-5-mini" } },
      { key: "langwatch.input", value: { stringValue: '{"type":"text","value":"hi"}' } },
    ],
  }) as OtlpSpan;

describe("createWorkerTraceTokenEstimation", () => {
  describe("given an LLM span with no token counts", () => {
    describe("when the estimation port runs", () => {
      /** @scenario "An estimated span is marked as estimated" */
      it("stamps the count and the estimated marker", async () => {
        const span = llmSpan();

        await createWorkerTraceTokenEstimation({
          config: { bpeDirectory: undefined, fetchTimeoutMs: 10_000 },
          featureFlags: flags(),
          tokenizer: new FixedTokenizer(),
        })
          .spanTokenEstimationPort()
          .estimate(span, "project-1");

        expect(span.attributes).toContainEqual({
          key: "gen_ai.usage.input_tokens",
          value: { intValue: 11 },
        });
        expect(span.attributes).toContainEqual({
          key: "langwatch.tokens.estimated",
          value: { boolValue: true },
        });
      });
    });

    describe("when the global kill switch is on", () => {
      /** @scenario "Either kill switch stops estimation" */
      it("leaves the span exactly as it arrived", async () => {
        const span = llmSpan();
        const tokenizer = new FixedTokenizer();

        await createWorkerTraceTokenEstimation({
          config: { bpeDirectory: undefined, fetchTimeoutMs: 10_000 },
          featureFlags: flags({ "token-estimation-killswitch": true }),
          tokenizer,
        })
          .spanTokenEstimationPort()
          .estimate(span, "project-1");

        expect(tokenizer.calls).toHaveLength(0);
        expect(span.attributes).toHaveLength(3);
      });
    });
  });

  describe("given no tokenizer is supplied", () => {
    describe("when the graph is composed", () => {
      it("builds the tiktoken transport from the process configuration alone", () => {
        const graph = createWorkerTraceTokenEstimation({
          config: { bpeDirectory: undefined, fetchTimeoutMs: 10_000 },
          featureFlags: flags(),
        });

        expect(graph.tokenizer).toBeInstanceOf(WorkerTiktokenCounterAdapter);
      });
    });
  });
});

describe("resolveWorkerConfig tokenizer leaves", () => {
  describe("given a deployment setting the tokenizer variables", () => {
    /** @scenario "The two tokenizer variables are read at the application's spellings" */
    it("reads them at the application's spellings", () => {
      expect(
        resolveWorkerConfig({
          TIKTOKENS_PATH: "/opt/tiktokens",
          TIKTOKEN_FETCH_TIMEOUT_MS: "2500",
        }).tokenizer,
      ).toEqual({ bpeDirectory: "/opt/tiktokens", fetchTimeoutMs: 2500 });
    });
  });

  describe("given a fetch timeout that is not a positive number", () => {
    /** @scenario "An unparseable fetch timeout falls back rather than refusing to boot" */
    it.each(["", "abc", "0", "-1"])("falls back to the application default for %j", (value) => {
      expect(
        resolveWorkerConfig({ TIKTOKEN_FETCH_TIMEOUT_MS: value }).tokenizer.fetchTimeoutMs,
      ).toBe(10_000);
    });

    /**
     * The application parses with `Number.parseInt`, which reads a leading
     * number out of a suffixed value rather than rejecting it. A stricter parse
     * here would refuse to boot on a value the application accepts.
     */
    it("keeps the application's leading-number parse", () => {
      expect(
        resolveWorkerConfig({ TIKTOKEN_FETCH_TIMEOUT_MS: "30s" }).tokenizer.fetchTimeoutMs,
      ).toBe(30);
    });
  });
});
