import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  buildInstantEvalJudgeRequest,
  instantEvalJudgeTextRoomBytes,
  scoreOnJudgeRange,
} from "../instant-eval-judge-question.rules.ts";

const FAIL_CONDITION = "return false if it mentions a competitor";

function askOf(request: ReturnType<typeof buildInstantEvalJudgeRequest>) {
  if (request.kind !== "ask") throw new Error(`expected ask, got ${request.kind}`);
  return request;
}

function boolean(inputs: Parameters<typeof buildInstantEvalJudgeRequest>[0]["inputs"]) {
  return buildInstantEvalJudgeRequest({
    judge: { evaluatorType: "langevals/llm_boolean", settings: { prompt: FAIL_CONDITION } },
    inputs,
  });
}

function scoreRequest(range: { min?: number; max?: number }) {
  return askOf(
    buildInstantEvalJudgeRequest({
      judge: { evaluatorType: "langevals/llm_score", settings: { prompt: "rate it", ...range } },
      inputs: { output: "an answer" },
    }),
  );
}

describe("buildInstantEvalJudgeRequest", () => {
  describe("given a judge mapped to an input, an output and two contexts", () => {
    /** @scenario "Input, output and contexts are labelled sections" */
    it("writes each as a labelled section", () => {
      const { text } = askOf(
        boolean({ input: "the question", output: "the answer", contexts: ["first", "second"] }),
      );
      expect(text).toBe(
        "# Input\nthe question\n\n# Output\nthe answer\n\n# Contexts\n1. first\n2. second",
      );
    });
  });

  describe("given an input far longer than the room, and a short output", () => {
    /** @scenario "A long input does not push out the output" */
    it("cuts the input and keeps the output whole", () => {
      const output = "the short answer";
      const { text, question } = askOf(boolean({ input: "x".repeat(500_000), output }));
      const room = instantEvalJudgeTextRoomBytes({ question });
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(room);
      expect(text.endsWith(`# Output\n${output}`)).toBe(true);
    });
  });

  describe("given an output longer than the whole room", () => {
    /** @scenario "An output longer than the whole room is cut keeping both ends" */
    it("keeps its first and its last lines", () => {
      const output = ["FIRST LINE", "y".repeat(500_000), "LAST LINE"].join("\n");
      const { text, question } = askOf(boolean({ output }));
      const room = instantEvalJudgeTextRoomBytes({ question });
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(room);
      expect(text.startsWith("# Output\nFIRST LINE")).toBe(true);
      expect(text.endsWith("LAST LINE")).toBe(true);
    });
  });

  describe("given a judge whose input, output and contexts are empty", () => {
    /** @scenario "A judge with no content to judge is skipped" */
    it("asks nothing", () => {
      expect(boolean({ input: "  ", output: "", contexts: ["", " "] }).kind).toBe(
        "nothing_to_judge",
      );
      expect(boolean({}).kind).toBe("nothing_to_judge");
    });
  });

  describe("given a boolean judge with a fail-condition prompt", () => {
    /** @scenario "A boolean question asks whether the instructions call for true" */
    it("carries the prompt as written, with true then false as its criteria", () => {
      const { question } = askOf(boolean({ output: "we beat the competitor" }));
      expect(question).toEqual({
        id: "judge",
        kind: "boolean",
        instructions: FAIL_CONDITION,
        criteria: ["the instructions call for true", "the instructions call for false"],
      });
    });
  });

  describe("given a category judge", () => {
    /** @scenario "A category judge returns the most likely category" */
    it("asks its categories as options", () => {
      const categories = [
        { name: "refund", description: "asks for money back" },
        { name: "complaint", description: "is unhappy" },
      ];
      const { question } = askOf(
        buildInstantEvalJudgeRequest({
          judge: {
            evaluatorType: "langevals/llm_category",
            settings: { prompt: "sort", categories },
          },
          inputs: { input: "I want my money back" },
        }),
      );
      expect(question).toEqual({
        id: "judge",
        kind: "category",
        instructions: "sort",
        options: categories,
      });
    });
  });

  describe("given a score judge", () => {
    /** @scenario "A whole-number range of at most ten levels is asked directly" */
    it("asks 1 to 5 directly", () => {
      expect(scoreRequest({ min: 1, max: 5 }).question).toMatchObject({
        range: { min: 1, max: 5 },
      });
    });

    /** @scenario "Any other range is asked on 1 to 10" */
    it("asks 0 to 100 on 1 to 10", () => {
      expect(scoreRequest({ min: 0, max: 100 }).question).toMatchObject({
        range: { min: 1, max: 10 },
      });
    });

    it("asks 0 to 1 on 1 to 10, since it is a fraction scale", () => {
      expect(scoreRequest({ min: 0, max: 1 }).question).toMatchObject({
        range: { min: 1, max: 10 },
      });
    });

    it("asks a range saved without bounds on 1 to 10", () => {
      expect(scoreRequest({}).question).toMatchObject({ range: { min: 1, max: 10 } });
    });
  });
});

describe("scoreOnJudgeRange", () => {
  describe("given the classifier answers at the top of the scale it was asked", () => {
    /** @scenario "A score judge returns on its own range" */
    it.each([
      { min: 0, max: 1 },
      { min: 1, max: 5 },
      { min: 0, max: 100 },
    ])("returns $max on $min to $max", (range) => {
      const asked = scoreRequest(range).question;
      if (asked.kind !== "score") throw new Error("expected a score question");
      expect(scoreOnJudgeRange({ answer: asked.range.max, range })).toBe(range.max);
    });

    /** @scenario "A score judge saved before the range setting reads as 0 to 1" */
    it("maps a range saved without bounds onto 0 to 1", () => {
      expect(scoreOnJudgeRange({ answer: 10, range: {} })).toBe(1);
    });
  });

  describe("given a range of 0 to 10", () => {
    /** @scenario "A range wider than ten levels, other than 0 to 1, returns whole numbers" */
    it.each([
      { answer: 2, score: 1 },
      { answer: 8, score: 8 },
    ])("an answer of $answer on 1 to 10 returns $score", ({ answer, score }) => {
      expect(scoreOnJudgeRange({ answer, range: { min: 0, max: 10 } })).toBe(score);
    });
  });

  describe("given a range of 0 to 1", () => {
    /** @scenario "A 0 to 1 range is a fraction and is not rounded" */
    it("returns 0.5 for 5.5 on 1 to 10", () => {
      expect(scoreOnJudgeRange({ answer: 5.5, range: { min: 0, max: 1 } })).toBe(0.5);
    });
  });

  describe("given a range asked directly", () => {
    it("returns the weighted mean as is", () => {
      expect(scoreOnJudgeRange({ answer: 3.4, range: { min: 1, max: 5 } })).toBe(3.4);
    });
  });
});

describe("instantEvalJudgeTextRoomBytes", () => {
  it("leaves less room than the classifier's state cap", () => {
    const { question } = askOf(boolean({ output: "a" }));
    expect(instantEvalJudgeTextRoomBytes({ question })).toBeLessThan(
      INSTANT_EVAL_CLASSIFIER_LIMITS.stateTokens *
        INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken,
    );
  });
});
