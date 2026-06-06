/**
 * Span-fold output-latching regression for claude_code Path B turns.
 *
 * A tool-using turn fans out into several model calls under ONE trace
 * (one prompt.id): a generate_session_title utility call, the main repl call
 * that decides the tool (its reply is a tool_use, withheld from output), the
 * follow-up repl call that produces the real assistant reply, and a
 * prompt_suggestion utility call AFTER it. The synthesized spans are all
 * parentless (each is a "root" to the fold), and the real reply sits on a
 * MIDDLE span, not the last one — so the fold must latch the conversational
 * completion and NOT let the later utility spans (which carry no output) leave
 * ComputedOutput null. This reproduces the user-reported "trace summary shows
 * input but no output even though a middle span says 'Done — output was ...'".
 */
import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

const DONE = "Done — output was `test otlp`.";

// Parentless, like every synthesized claude_code span (parentSpanId=null).
function claudeSpan(over: Partial<NormalizedSpan>): NormalizedSpan {
  return createTestSpan({ parentSpanId: null, ...over });
}

function foldAll(spans: NormalizedSpan[]): TraceSummaryData {
  let state = createInitState();
  for (const span of spans) {
    state = { ...state, ...applySpanToSummary({ state, span }) };
  }
  return state;
}

const generateTitle = claudeSpan({
  spanId: "title",
  startTimeUnixMs: 1000,
  endTimeUnixMs: 1190,
  // generate_session_title is a utility call: completion withheld -> no output.
  spanAttributes: {
    "langwatch.span.type": "llm",
    "gen_ai.request.model": "claude-haiku-4-5-20251001",
  },
});

const callDecidesTool = claudeSpan({
  spanId: "callA",
  startTimeUnixMs: 1001,
  endTimeUnixMs: 2290,
  // The repl call that emits a tool_use: completion is withheld -> no output.
  spanAttributes: {
    "langwatch.span.type": "llm",
    "gen_ai.request.model": "claude-opus-4-8",
    "gen_ai.input.messages":
      '[{"role":"user","content":"can you do `echo test otlp`"}]',
  },
});

const callAfterTool = claudeSpan({
  spanId: "callB",
  startTimeUnixMs: 3000,
  endTimeUnixMs: 5290,
  // The follow-up repl call carrying the real assistant reply.
  spanAttributes: {
    "langwatch.span.type": "llm",
    "gen_ai.request.model": "claude-opus-4-8",
    "gen_ai.output.messages": `[{"role":"assistant","content":"${DONE}"}]`,
  },
});

const promptSuggestion = claudeSpan({
  spanId: "suggest",
  // Fires AFTER the reply (latest end time) but carries no output.
  startTimeUnixMs: 5300,
  endTimeUnixMs: 6700,
  spanAttributes: {
    "langwatch.span.type": "llm",
    "gen_ai.request.model": "claude-opus-4-8",
  },
});

describe("claude_code span-fold output latching", () => {
  describe("when the reply sits on a middle span and utility calls follow", () => {
    it("latches the conversational completion as ComputedOutput", () => {
      const state = foldAll([
        generateTitle,
        callDecidesTool,
        callAfterTool,
        promptSuggestion,
      ]);
      expect(state.computedOutput).toBe(DONE);
    });

    it("does not let the later no-output prompt_suggestion clobber it", () => {
      // prompt_suggestion has the LATEST end time but no output, so it must not
      // reset ComputedOutput to null.
      const withSuggestionLast = foldAll([callAfterTool, promptSuggestion]);
      expect(withSuggestionLast.computedOutput).toBe(DONE);
    });
  });

  describe("when two conversational replies exist in one turn", () => {
    it("keeps the latest reply by end time, independent of fold order", () => {
      const earlier = claudeSpan({
        spanId: "early",
        startTimeUnixMs: 1000,
        endTimeUnixMs: 2000,
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.request.model": "claude-opus-4-8",
          "gen_ai.output.messages":
            '[{"role":"assistant","content":"Let me check that."}]',
        },
      });
      const later = claudeSpan({
        spanId: "late",
        startTimeUnixMs: 3000,
        endTimeUnixMs: 4000,
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.request.model": "claude-opus-4-8",
          "gen_ai.output.messages": `[{"role":"assistant","content":"${DONE}"}]`,
        },
      });
      // Fold in time order AND reversed: the latest-ending reply must win both.
      expect(foldAll([earlier, later]).computedOutput).toBe(DONE);
      expect(foldAll([later, earlier]).computedOutput).toBe(DONE);
    });
  });
});
