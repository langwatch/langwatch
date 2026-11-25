/**
 * LangWatch's cloud judge hands a routed query's route and ceiling to the Instant Evals judge.
 * @see specs/lwql/eval-functions.feature
 */
import type {
  InstantEvalClassification,
  InstantEvalJudgeCostCeiling,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { InstantEvalCloudJudgeService } from "../instant-eval-cloud-judge.service.ts";

const QUESTION = { id: "q", kind: "boolean", instructions: "is it upset" } as const;

function cloudJudge() {
  const sent: InstantEvalClassification[] = [];
  const judge = InstantEvalCloudJudgeService.create({
    judges: {
      classify: async (input) => {
        sent.push(input);
        return { verdicts: [], inputTokens: 0, isTextTruncated: false };
      },
    },
  });
  return { judge, sent };
}

describe("InstantEvalCloudJudgeService.classify", () => {
  /** @scenario "LangWatch's cloud judge passes a routed query's route and ceiling to the judge" */
  it("sends the route and the cost ceiling with the request", async () => {
    const { judge, sent } = cloudJudge();
    const costCeiling: InstantEvalJudgeCostCeiling = { hold: async () => true, settle: () => {} };

    await judge.classify({
      projectId: "project-1",
      text: "user: late again",
      questions: [QUESTION],
      route: { job: "search" },
      costCeiling,
    });

    expect(sent[0]?.route).toEqual({ job: "search" });
    expect(sent[0]?.costCeiling).toBe(costCeiling);
  });

  /** @scenario "With the search router flag off a judged query sends no route" */
  it("sends no route for a request that carries none", async () => {
    const { judge, sent } = cloudJudge();

    await judge.classify({ projectId: "project-1", text: "x", questions: [QUESTION] });

    expect(sent[0]).not.toHaveProperty("route");
    expect(sent[0]).not.toHaveProperty("costCeiling");
  });
});
