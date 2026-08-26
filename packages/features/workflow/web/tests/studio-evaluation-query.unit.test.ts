import { describe, expect, it } from "vitest";
import { isExperimentQueryEnabled } from "../src/studio-evaluation-query";

describe("isExperimentQueryEnabled()", () => {
  it("enables the query from the persisted workflow id", () => {
    const result = isExperimentQueryEnabled({
      hasProject: true,
      workflowId: "my-workflow-id",
    });

    expect(result).toBe(true);
  });

  it("disables the query without a workflow id", () => {
    const result = isExperimentQueryEnabled({
      hasProject: true,
      workflowId: void 0,
    });

    expect(result).toBe(false);
  });

  it("disables the query without a project", () => {
    const result = isExperimentQueryEnabled({
      hasProject: false,
      workflowId: "my-workflow-id",
    });

    expect(result).toBe(false);
  });
});
