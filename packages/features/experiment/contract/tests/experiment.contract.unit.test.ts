import { describe, expect, it } from "vitest";
import {
  experimentSchema,
  experimentTypeSchema,
  saveExperimentInputSchema,
} from "../src";

describe("Experiment contract", () => {
  it("accepts only the stable experiment type vocabulary", () => {
    expect(experimentTypeSchema.parse("EVALUATIONS_V3")).toBe(
      "EVALUATIONS_V3",
    );
    expect(experimentTypeSchema.safeParse("OTHER").success).toBe(false);
  });

  it("rejects non-JSON workbench state", () => {
    const result = experimentSchema.safeParse({
      id: "experiment_1",
      name: "Run",
      type: "EVALUATIONS_V3",
      slug: "run",
      projectId: "project_1",
      workflowId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      workbenchState: new Map(),
    });
    expect(result.success).toBe(false);
  });

  it("requires the caller to state the slug policy", () => {
    expect(
      saveExperimentInputSchema.safeParse({
        id: "experiment_1",
        projectId: "project_1",
        name: "Run",
        type: "EVALUATIONS_V3",
        requestedSlug: "run",
        workflowId: null,
        workbenchState: null,
      }).success,
    ).toBe(false);
  });
});
