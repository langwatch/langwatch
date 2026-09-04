import { describe, expect, it } from "vitest";
import { TraceSummaryFoldProjection } from "../trace-summary.projection";
import { createInitState, createTestRuntime, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

const runtime = createTestRuntime();
const applySpanToSummary = (input: {
  state: ReturnType<typeof createInitState>;
  span: ReturnType<typeof createTestSpan>;
}) => TraceSummaryFoldProjection.applySpanToSummary({ ...input, runtime });

// Copilot CLI emits a root `invoke_agent` span whose gen_ai.usage.* is the
// EXACT rollup of its `chat` children (verified on the 1.0.79 wire: one turn
// emits chat=15560/153 AND invoke_agent=15560/153). The copilot canonicaliser
// flags the rollup with langwatch.reserved.skip_token_accumulation (covered by
// copilot.unit.test.ts) so the fold counts the turn once — that fold behaviour
// is what this test pins.
describe("applySpanToSummary copilot rollup-usage handling", () => {
  describe("given a copilot turn whose invoke_agent root repeats its chat child's usage", () => {
    describe("when both canonicalized spans are folded into the trace summary", () => {
      /** @scenario "Copilot turn tokens are counted once across the agent rollup and its chat span" */
      it("counts the usage once, not twice", () => {
        const chatSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 15560,
            "gen_ai.usage.output_tokens": 153,
          },
        });
        const agentSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.usage.input_tokens": 15560,
            "gen_ai.usage.output_tokens": 153,
            "github.copilot.turn_id": "t1",
            "langwatch.reserved.skip_token_accumulation": "true",
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: chatSpan });
        state = applySpanToSummary({ state, span: agentSpan });

        expect(state.totalPromptTokenCount).toBe(15560);
        expect(state.totalCompletionTokenCount).toBe(153);
      });
    });

    describe("when the rollup is not flagged (control)", () => {
      it("double-counts the usage", () => {
        const chatSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 15560,
            "gen_ai.usage.output_tokens": 153,
          },
        });
        const unflaggedAgentSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.usage.input_tokens": 15560,
            "gen_ai.usage.output_tokens": 153,
            "github.copilot.turn_id": "t1",
          },
        });

        let state = createInitState();
        state = applySpanToSummary({ state, span: chatSpan });
        state = applySpanToSummary({ state, span: unflaggedAgentSpan });

        expect(state.totalPromptTokenCount).toBe(31120);
      });
    });
  });
});
