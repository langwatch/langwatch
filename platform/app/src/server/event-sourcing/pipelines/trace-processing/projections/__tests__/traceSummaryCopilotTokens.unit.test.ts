import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation/canonicalizeSpanAttributesService";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

// Copilot CLI emits a root `invoke_agent` span whose gen_ai.usage.* is the
// EXACT rollup of its `chat` children (verified on the 1.0.79 wire: one turn
// emits chat=15560/153 AND invoke_agent=15560/153). The copilot extractor
// flags the rollup with langwatch.reserved.skip_token_accumulation so the
// fold counts the turn once. This test runs the REAL extractor chain into
// the REAL fold — not a pre-flagged fixture — so a regression in either the
// marker or the fold's respect for it fails here.
describe("applySpanToSummary copilot rollup-usage handling", () => {
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    );
    extractSpy.mockReturnValue(null);
  });

  afterEach(() => {
    extractSpy.mockRestore();
  });

  const canonicalize = (
    name: string,
    attrs: Record<string, unknown>,
  ): Record<string, unknown> =>
    new CanonicalizeSpanAttributesService().canonicalize(
      attrs as Parameters<CanonicalizeSpanAttributesService["canonicalize"]>[0],
      [],
      {
        name,
        kind: 0,
        instrumentationScope: { name: "github.copilot" },
        statusMessage: null,
        statusCode: null,
        parentSpanId: null,
      } as unknown as Parameters<
        CanonicalizeSpanAttributesService["canonicalize"]
      >[2],
    ).attributes;

  describe("given a copilot turn whose invoke_agent root repeats its chat child's usage", () => {
    describe("when both canonicalized spans are folded into the trace summary", () => {
      /** @scenario Copilot turn tokens are counted once across the agent rollup and its chat span */
      it("counts the usage once, not twice", () => {
        // Real wire shape (copilot 1.0.79): chat carries the model call's
        // usage; invoke_agent repeats the identical totals as a rollup.
        const chatAttrs = canonicalize("chat gpt-5-mini", {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": 15560,
          "gen_ai.usage.output_tokens": 153,
        });
        const agentAttrs = canonicalize("invoke_agent copilot", {
          "gen_ai.operation.name": "invoke_agent",
          "gen_ai.usage.input_tokens": 15560,
          "gen_ai.usage.output_tokens": 153,
          "github.copilot.turn_id": "t1",
        });

        // The extractor — not the fixture — must have produced the marker.
        expect(agentAttrs["langwatch.reserved.skip_token_accumulation"]).toBe(
          "true",
        );
        expect(
          chatAttrs["langwatch.reserved.skip_token_accumulation"],
        ).toBeUndefined();

        let state = createInitState();
        state = applySpanToSummary({
          state,
          span: createTestSpan({
            spanAttributes: chatAttrs as Record<string, string | number>,
          }),
        });
        state = applySpanToSummary({
          state,
          span: createTestSpan({
            spanAttributes: agentAttrs as Record<string, string | number>,
          }),
        });

        expect(state.totalPromptTokenCount).toBe(15560);
        expect(state.totalCompletionTokenCount).toBe(153);
      });
    });
  });

  describe("given an invoke_agent span with no usage of its own", () => {
    describe("when it is canonicalized", () => {
      it("gets no skip marker, so a future usage-bearing agent span still counts", () => {
        const agentAttrs = canonicalize("invoke_agent copilot", {
          "gen_ai.operation.name": "invoke_agent",
          "github.copilot.turn_id": "t1",
        });

        expect(
          agentAttrs["langwatch.reserved.skip_token_accumulation"],
        ).toBeUndefined();
      });
    });
  });
});
