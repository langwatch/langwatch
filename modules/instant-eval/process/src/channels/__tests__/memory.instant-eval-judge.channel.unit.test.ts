/**
 * The memory stand-in judge: every question answered from a hash of the text,
 * so a development run completes and repeats exactly.
 * @see specs/instant-evals/classifier.feature
 */

import type { InstantEvalQuestion } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import { estimateInstantEvalRequestTokens } from "../../rules/instant-eval-token-budget.rules.ts";
import { DeterministicInstantEvalJudgeChannel } from "../memory/memory.instant-eval-judge.channel.ts";

const questions: InstantEvalQuestion[] = [
  { id: "q1", kind: "boolean", instructions: "Is it polite?" },
  { id: "q2", kind: "score", instructions: "How helpful?", range: { min: 1, max: 5 } },
  {
    id: "q3",
    kind: "category",
    instructions: "Which topic?",
    options: [
      { name: "billing", description: "Money" },
      { name: "support", description: "Help" },
    ],
  },
];

describe("DeterministicInstantEvalJudgeChannel", () => {
  /** @scenario "The memory judge answers every question the same way for the same text" */
  it("answers each question in its own kind, the same way every time", async () => {
    const judge = DeterministicInstantEvalJudgeChannel.create();
    const request = { projectId: "project-1", text: "Thanks, that fixed it.", questions };

    const first = await judge.classify(request);
    const second = await judge.classify(request);

    expect(second).toEqual(first);
    expect(first.skippedReason).toBeUndefined();
    expect(first.inputTokens).toBe(
      estimateInstantEvalRequestTokens({ text: request.text, questions }),
    );
    const [boolean, score, category] = first.verdicts;
    expect(first.verdicts.map((verdict) => verdict.questionId)).toEqual(["q1", "q2", "q3"]);
    expect(boolean?.probability).toBeGreaterThanOrEqual(0);
    expect(boolean?.probability).toBeLessThan(1);
    expect(score?.score).toBeGreaterThanOrEqual(1);
    expect(score?.score).toBeLessThanOrEqual(5);
    expect(["billing", "support"]).toContain(category?.label);
    expect(Object.values(category?.probabilities ?? {}).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("answers a different text differently", async () => {
    const judge = DeterministicInstantEvalJudgeChannel.create();
    const answers = await Promise.all(
      ["one", "two", "three", "four"].map((text) =>
        judge.classify({ projectId: "project-1", text, questions: questions.slice(0, 1) }),
      ),
    );

    const probabilities = new Set(answers.map((answer) => answer.verdicts[0]?.probability));
    expect(probabilities.size).toBe(4);
  });
});
