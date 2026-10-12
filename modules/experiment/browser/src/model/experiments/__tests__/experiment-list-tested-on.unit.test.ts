/** @see modules/experiment/specs/experiment-list-page.feature */
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import { testedOnOf } from "../experiment-list-tested-on.ts";

const runWith = (items: number, targets = 2): ExperimentRunWithItems => ({
  experimentId: "e",
  runId: "r",
  projectId: "p",
  targets: [],
  dataset: Array.from({ length: items }, (_, index) =>
    Array.from({ length: targets }, (_, target) => ({
      index,
      targetId: `t${target}`,
      entry: { id: `item-${index}`, input: { text: `question ${index}` } },
    })),
  ).flat(),
  evaluations: [],
  timestamps: { createdAt: 1, updatedAt: 1 },
  completeness: {
    complete: true,
    dataset: { received: 0, expected: null },
    evaluations: { received: 0, expected: null },
  },
});

describe("given a run's items", () => {
  /** @scenario Tested-on examples are spread across the set */
  it("counts each item once however many targets ran it, and spreads three examples", () => {
    const tested = testedOnOf(runWith(10))!;
    expect(tested.items).toBe(10);
    expect(tested.fields).toEqual(["id", "input"]);
    expect(tested.examples.map((example) => example.id)).toEqual(["item-1", "item-5", "item-8"]);
  });

  it("writes a nested value as one line of text", () => {
    expect(testedOnOf(runWith(3))!.examples[0]!.input).toBe('{"text":"question 0"}');
  });

  it("gives as many examples as there are items when there are few", () => {
    expect(testedOnOf(runWith(2))!.examples).toHaveLength(2);
  });

  it("truncates a long value", () => {
    const run = runWith(1, 1);
    run.dataset[0]!.entry = { text: "x".repeat(500) };
    expect(testedOnOf(run)!.examples[0]!.text!.length).toBeLessThan(200);
  });

  it("has nothing to say about a run with no items", () => {
    expect(testedOnOf(runWith(0))).toBeUndefined();
  });
});
