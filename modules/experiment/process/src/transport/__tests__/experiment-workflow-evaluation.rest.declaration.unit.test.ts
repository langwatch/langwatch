/**
 * @vitest-environment node
 * The workflow evaluate door's addresses, operation id and permissions, pinned
 * to what it answered while workflow served it.
 * @see modules/experiment/specs/workflow-evaluation-trigger.feature
 */
import { describe, expect, it } from "vitest";

import { experimentWorkflowEvaluationRest } from "../experiment-workflow-evaluation.rest.ts";

const declaration = experimentWorkflowEvaluationRest.router();

describe("the workflow evaluate REST family", () => {
  describe("given the declaration experiment mounts", () => {
    /** @scenario "The workflow evaluate door keeps its wire after the move" */
    it("keeps the dated /api/workflows address, the operation id and both permissions", () => {
      expect(declaration.namespace).toBe("workflows");
      expect(declaration.addressing).toBe("dated");
      expect(declaration.v1Twin).toBe(true);
      expect(declaration.credential).toBe("project");
      expect(
        declaration.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permissions,
          route.sharedPath?.owner,
        ]),
      ).toEqual([
        [
          "post",
          "/:id/evaluate",
          "postApiWorkflowsByIdEvaluate",
          ["workflows:create", "evaluations:view"],
          "workflow",
        ],
      ]);
    });
  });
});
