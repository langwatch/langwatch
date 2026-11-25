/**
 * The gate's frozen text and question, pinned against the output of the reference the gate's
 * threshold was measured with: an edit to the wording or the cut fails here.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */
import { createHash } from "node:crypto";

import {
  INSTANT_EVAL_JUDGE_GATE_QUESTIONS,
  type InstantEvalJudgeGateQuestionName,
  toClassifierQuestions,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  instantEvalJudgeGateBranchOf,
  instantEvalJudgeGateInputOf,
  instantEvalJudgeGateQuestionOf,
} from "../instant-eval-judge-gate.rules.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** 30,000 characters of numbered lines, so the test sees which lines the cut keeps. */
const LONG_TEXT = Array.from(
  { length: 1500 },
  (_, line) => `line ${String(line).padStart(4, "0")}: abcdefgh\n`,
).join("");

describe("instantEvalJudgeGateInputOf", () => {
  /** @scenario "The gate reads a frozen framing of the case" */
  it("frames a short evaluator case whole, word for word as the reference does", () => {
    const input = instantEvalJudgeGateInputOf({
      job: "llm_judge",
      task: "Is the reply polite?",
      text: "user: hi\nassistant: hello",
    });
    expect(input).toBe(
      "An evaluation case that a judge model must decide. You are NOT asked for the verdict; the questions are about which judge should decide it.\n\nJob: LLM-as-a-judge evaluator: does the output pass this evaluator's check?\nTask: Is the reply polite?\nText length: 25 characters (the view below may be cut in the middle)\n\n<text>\nuser: hi\nassistant: hello\n</text>",
    );
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("cuts a 30,000 character text to its two ends and the task to 3,000 characters", () => {
    const input = instantEvalJudgeGateInputOf({
      job: "llm_judge",
      task: "Check the refund. ".repeat(200),
      text: LONG_TEXT,
    });
    expect(input).toContain("Text length: 30000 characters");
    expect(input).toContain(
      "line 0299: abcdefgh\n\n\n[... 18000 characters cut ...]\n\nline 1200: abcdefgh\n",
    );
    expect(input).toHaveLength(15_346);
    expect(sha256(input)).toBe("9480cc2b1d0a91b9c231224707887d21c9bab2138666396cafb091f096aa158a");
  });

  /** @scenario "The gate reads a frozen framing of the case" */
  it("names the job being judged", () => {
    const of = (job: "search" | "scenario_judge") =>
      sha256(
        instantEvalJudgeGateInputOf({
          job,
          task: job === "search" ? "Did the user ask for a refund?" : "The agent offers a refund",
          text:
            job === "search"
              ? "user: refund please"
              : "# Scenario\nA user wants a refund\n\nuser: refund please",
        }),
      );
    expect(of("search")).toBe("cffebeccf897c6ed5c2bb77b1d200a4f9cbf8aa12855adbfb349aeffc05ecbae");
    expect(of("scenario_judge")).toBe(
      "d59441c1279140bb53a94506e72e4433223c3828e4ace478381e593477bcf56c",
    );
  });
});

describe("instantEvalJudgeGateQuestionOf", () => {
  /** @scenario "The gate reads a frozen framing of the case" */
  it("asks one score question whose five levels go on the wire as named, easiest first", () => {
    const question = instantEvalJudgeGateQuestionOf({ name: "difficulty_v1", id: "q" });
    expect(question.range).toEqual({ min: 0, max: 4 });
    expect(toClassifierQuestions([question])).toEqual({
      q: {
        type: "score",
        instructions: "How hard is it for a judge model to get the verdict on this case right?",
        criteria: [
          "trivial: the answer is plainly stated or obviously present or absent",
          "easy: one quick read decides it",
          "moderate: needs care: a detail, an exception or some evidence to find",
          "hard: needs multi-step checking: numbers, dates, rules or tiers, several facts",
          "very hard: subtle errors, buried evidence in a long text, or a long chain of steps",
        ],
      },
    });
  });
});

describe("given every gate question the contract names", () => {
  /** @scenario "A gate names a hosted classifier backend and an escalation, nothing else" */
  it.each(Object.keys(INSTANT_EVAL_JUDGE_GATE_QUESTIONS) as InstantEvalJudgeGateQuestionName[])(
    "%s names as many levels as the contract bounds a threshold by",
    (name) => {
      const question = instantEvalJudgeGateQuestionOf({ name, id: "q" });
      const { levelCount } = INSTANT_EVAL_JUDGE_GATE_QUESTIONS[name];
      expect(question.levels).toHaveLength(levelCount);
      expect(question.range).toEqual({ min: 0, max: levelCount - 1 });
    },
  );
});

describe("instantEvalJudgeGateBranchOf", () => {
  /** @scenario "A gate sends an easy case to the primary alone and the rest to the escalation alone" */
  it("is easy only on a score under the threshold", () => {
    const branch = (score: number) =>
      instantEvalJudgeGateBranchOf({ verdict: { score }, easyBelow: 1.5 }).branch;
    expect(branch(1.49)).toBe("easy");
    expect(branch(1.5)).toBe("hard");
    expect(branch(3)).toBe("hard");
  });

  /** @scenario "A gate that gives no score sends the case to the escalation" */
  it("is hard, and says it had no score, when nothing readable came back", () => {
    const unrated = { branch: "hard", hasScore: false };
    expect(instantEvalJudgeGateBranchOf({ verdict: undefined, easyBelow: 1.5 })).toEqual(unrated);
    expect(instantEvalJudgeGateBranchOf({ verdict: {}, easyBelow: 1.5 })).toEqual(unrated);
    expect(
      instantEvalJudgeGateBranchOf({ verdict: { score: Number.NaN }, easyBelow: 1.5 }),
    ).toEqual(unrated);
  });
});
