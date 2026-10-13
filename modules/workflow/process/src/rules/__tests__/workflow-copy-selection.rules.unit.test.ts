import type { Workflow } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { freshCopyDsl, selectCopiesToPush } from "../workflow-copy-selection.rules.ts";

const copy = (id: string, projectId: string) => ({ id, projectId }) as Workflow;

describe("selectCopiesToPush", () => {
  const copies = [copy("a", "p1"), copy("b", "p2")];

  it("keeps every copy when no filter is given", () => {
    expect(selectCopiesToPush({ copies })).toHaveLength(2);
  });

  it("narrows by id and by allowed project", () => {
    expect(selectCopiesToPush({ copies, copyIds: ["a", "b"], allowedProjectIds: ["p2"] })).toEqual([
      copies[1],
    ]);
  });
});

describe("freshCopyDsl", () => {
  it("resets the version, experiment and state", () => {
    const dsl = freshCopyDsl({
      dsl: { version: "7", experiment_id: "x", state: { a: 1 } } as never,
      workflowId: "w",
    });

    expect(dsl).toMatchObject({ workflow_id: "w", version: "1", experiment_id: "", state: {} });
  });
});
