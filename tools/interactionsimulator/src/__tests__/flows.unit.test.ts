import { resolveAction } from "@langwatch/visual-diff-runner/src/flows/registry";
import { describe, expect, it } from "vitest";

import { flowFile, journeyFlow } from "../flows";

/**
 * The emitted file is pinned to testdata/flows/simulated.yaml, which
 * flows_load_test.go loads through visualdiff's own LoadConfig.
 */
describe("flowFile", () => {
  const flow = journeyFlow({
    feature: "dataset",
    journey: {
      id: "create",
      goal: "Create a dataset and see it listed",
      start: "/{slug}/datasets",
      steps: ["Click New dataset", "Name it", "Save"],
      values: { name: "Sim dataset {uid}" },
      proof: { path: "/{slug}/datasets", texts: ["Sim dataset {uid}"] },
    },
    steps: [
      { action: "click", with: { testId: "new-dataset" } },
      {
        action: "fill",
        with: { selector: 'role=textbox[name="Name"s]', value: "Sim dataset {uid}" },
      },
      { action: "click", with: { selector: 'role=button[name="Save"s]' } },
    ],
  });

  it("names only actions the visualdiff runner implements", () => {
    for (const step of flow.steps) expect(() => resolveAction(step.action)).not.toThrow();
  });

  it("ends by reloading the proof page and expecting each proof text", () => {
    expect(flow.steps.slice(-2)).toEqual([
      { action: "go", with: { path: "/{slug}/datasets" } },
      { action: "expect", with: { text: "Sim dataset {uid}" } },
    ]);
  });

  it("writes the file visualdiff's loader reads", async () => {
    await expect(flowFile({ feature: "dataset", flows: [flow] })).toMatchFileSnapshot(
      "../../testdata/flows/simulated.yaml",
    );
  });
});
