/**
 * A scenario judgement's pure steps: the criterion question, the verdict call read back by key,
 * what a routed verdict means, and the bucket a judged text takes.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */
import { describe, expect, it } from "vitest";

import {
  finishTestInput,
  syntheticScenarioRouteTable,
} from "../../__tests__/support/instant-eval-scenario-judge.test-fakes.ts";
import { instantEvalJudgeRoutePlanOf } from "../instant-eval-judge-route.rules.ts";
import {
  findInstantEvalScenarioVerdictReading,
  instantEvalScenarioCriterionResultOf,
  instantEvalScenarioLlmVerdictOf,
  instantEvalScenarioQuestionOf,
  instantEvalScenarioTextOf,
} from "../instant-eval-scenario-judge.rules.ts";

describe("instantEvalScenarioQuestionOf", () => {
  /** @scenario "A criterion's question keeps the measured wording" */
  it("names the criterion after the fixed judging sentence, with its two sides", () => {
    const question = instantEvalScenarioQuestionOf({
      key: "criterion_0",
      text: "The agent offers a refund",
    });

    expect(question).toEqual({
      id: "criterion_0",
      kind: "boolean",
      instructions:
        "Judge the AI agent under test (the assistant) in this simulated conversation against one success criterion, independently of any other goal. Criterion: The agent offers a refund",
      criteria: [
        "The conversation shows the criterion was met.",
        "The conversation does not show the criterion was met: it was violated, or the evidence for it is missing.",
      ],
    });
  });

  /** @scenario "A criterion's question keeps the measured wording" */
  it("cuts a criterion past 4,000 characters in its question", () => {
    const question = instantEvalScenarioQuestionOf({ key: "k", text: "a".repeat(5_000) });

    expect(question.instructions.endsWith(`Criterion: ${"a".repeat(4_000)}`)).toBe(true);
  });
});

describe("instantEvalScenarioTextOf", () => {
  /** @scenario "Each criterion is routed as its own yes or no question" */
  it("heads the judge's content with the scenario's description", () => {
    expect(instantEvalScenarioTextOf({ description: "a refund", content: "<transcript/>" })).toBe(
      "# Scenario\na refund\n\n<transcript/>",
    );
  });
});

describe("findInstantEvalScenarioVerdictReading", () => {
  /** @scenario "Unsure criteria share one send of the judge's own verdict call" */
  it("reads each criterion by key and the reasoning, leaving out an unreadable entry", () => {
    const reading = findInstantEvalScenarioVerdictReading({
      criteria: { a: "true", b: "false", c: "inconclusive", d: "maybe", e: true },
      reasoning: "because",
      verdict: "failure",
    });

    expect(reading && [...reading.criteria]).toEqual([
      ["a", "true"],
      ["b", "false"],
      ["c", "inconclusive"],
      ["e", "true"],
    ]);
    expect(reading?.reasoning).toBe("because");
  });

  /** @scenario "The shared verdict call is read in the scenario SDK's per-criterion shape" */
  it("reads the SDK's requirement, reasoning and status object per criterion", () => {
    const reading = findInstantEvalScenarioVerdictReading(
      finishTestInput({
        criterion_0: "passed",
        criterion_1: "failed",
        criterion_2: "inconclusive",
      }),
    );

    expect(reading && [...reading.criteria]).toEqual([
      ["criterion_0", "true"],
      ["criterion_1", "false"],
      ["criterion_2", "inconclusive"],
    ]);
  });

  /** @scenario "The shared verdict call is read in the scenario SDK's per-criterion shape" */
  it("reads a bare status, and leaves out an object with an unknown or missing status", () => {
    const reading = findInstantEvalScenarioVerdictReading({
      criteria: {
        a: "passed",
        b: "failed",
        c: { requirement: "r", reasoning: "r", status: "maybe" },
        d: { requirement: "r", reasoning: "r" },
      },
      reasoning: "summary",
    });

    expect(reading && [...reading.criteria]).toEqual([
      ["a", "true"],
      ["b", "false"],
    ]);
  });

  /** @scenario "Unsure criteria share one send of the judge's own verdict call" */
  it("reads nothing from arguments with no criteria object", () => {
    expect(findInstantEvalScenarioVerdictReading({ verdict: "success" })).toBeUndefined();
    expect(findInstantEvalScenarioVerdictReading("finish")).toBeUndefined();
  });
});

describe("instantEvalScenarioCriterionResultOf", () => {
  /** @scenario "A sure decision answer settles its criterion without an LLM call" */
  it("is met at one half or more, unmet below, and inconclusive without a probability", () => {
    const of = (probability: number) =>
      instantEvalScenarioCriterionResultOf({ questionId: "k", probability });

    expect([of(1), of(0.5), of(0.49), of(0)]).toEqual(["met", "met", "unmet", "unmet"]);
    expect(instantEvalScenarioCriterionResultOf(undefined)).toBe("inconclusive");
    expect(
      instantEvalScenarioCriterionResultOf(
        instantEvalScenarioLlmVerdictOf({ questionId: "k", answer: "inconclusive" }),
      ),
    ).toBe("inconclusive");
  });
});

describe("given a table whose short bucket ends at 7,999 tokens", () => {
  const table = syntheticScenarioRouteTable();
  const planFor = (tokens: number) =>
    instantEvalJudgeRoutePlanOf({
      route: { job: "scenario_judge", tokens },
      text: "transcript",
      questions: [instantEvalScenarioQuestionOf({ key: "k", text: "criterion" })],
      table,
    });

  /** @scenario "The length bucket picks the criterion's route" */
  it("plans 7,999 tokens on the short slot and 8,000 on the long slot", () => {
    expect(planFor(7_999)).toMatchObject({
      slot: "short",
      primary: "decision-a",
      escalateTo: "llm-a",
      threshold: 0.98,
    });
    expect(planFor(8_000)).toMatchObject({
      slot: "long",
      primary: "decision-b",
      escalateTo: "llm-b",
      threshold: 0.8,
    });
  });
});
