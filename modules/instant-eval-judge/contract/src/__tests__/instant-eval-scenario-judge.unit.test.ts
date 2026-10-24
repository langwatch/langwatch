/**
 * Scenario criteria as router questions: the measured wording (shared verbatim with the Python
 * reference router's clients.py), the judged text and the met / not met read back.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import { describe, expect, it } from "vitest";

import {
  instantEvalCriterionQuestionOf,
  instantEvalCriterionVerdictsOf,
  instantEvalScenarioJudgeTextOf,
} from "../instant-eval-scenario-judge.ts";

describe("scenario criteria as router questions", () => {
  /** @scenario "A scenario criterion is one yes-or-no question in the measured wording" */
  it("words a criterion as the scenario routes were measured, both sides spelled out", () => {
    expect(
      instantEvalCriterionQuestionOf({ id: "c0", criterion: "The agent offers a refund." }),
    ).toEqual({
      id: "c0",
      kind: "boolean",
      instructions:
        "Judge the AI agent under test (the assistant) in this simulated conversation against one success criterion, independently of any other goal. Criterion: The agent offers a refund.",
      criteria: [
        "The conversation shows the criterion was met.",
        "The conversation does not show the criterion was met: it was violated, or the evidence for it is missing.",
      ],
    });
    const long = instantEvalCriterionQuestionOf({ id: "c1", criterion: "x".repeat(5000) });
    expect(long.instructions).toHaveLength(4000);
  });

  /** @scenario "A scenario criterion is one yes-or-no question in the measured wording" */
  it("judges the scenario description and the conversation together", () => {
    expect(
      instantEvalScenarioJudgeTextOf({ description: "A late order.", conversation: "user: hi" }),
    ).toBe("# Scenario\nA late order.\n\n# Conversation\nuser: hi");
  });

  /** @scenario "A scenario criterion is one yes-or-no question in the measured wording" */
  it("reads met at one half or more, and an unanswered criterion as null, never as not met", () => {
    const questions = ["a", "b", "c"].map((id) =>
      instantEvalCriterionQuestionOf({ id, criterion: id }),
    );
    const verdicts = instantEvalCriterionVerdictsOf({
      questions,
      judgement: {
        verdicts: [
          { questionId: "a", probability: 0.5 },
          { questionId: "b", probability: 0.2 },
        ],
        inputTokens: 10,
        isTextTruncated: false,
      },
    });
    expect(verdicts).toEqual([
      { id: "a", met: true, probability: 0.5 },
      { id: "b", met: false, probability: 0.2 },
      { id: "c", met: null, probability: null },
    ]);
  });
});
