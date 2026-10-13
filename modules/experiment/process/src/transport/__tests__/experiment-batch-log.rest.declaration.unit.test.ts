/**
 * @vitest-environment node
 * The batch log door's address, operation id, door and access kind, pinned to
 * what it answered while evaluation served it.
 * @see modules/experiment/specs/experiment-batch-log.feature
 */
import { DATASET_CEILING_LIMITS, DATASET_DEFAULT_LIMITS } from "@langwatch/dataset-contract";
import { describe, expect, it } from "vitest";

import { experimentBatchLogRest } from "../experiment-batch-log.rest.ts";

const declaration = experimentBatchLogRest.router();

describe("the SDK batch result log REST family", () => {
  describe("given the declaration experiment mounts", () => {
    /** @scenario "The batch log door keeps its wire after the move" */
    it("keeps the literal address, its /api/v1 twin, the operation id and evaluations:manage", () => {
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(true);
      expect(declaration.credential).toBe("project");
      expect(
        declaration.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permission,
          route.response?.kind,
          route.rawBody?.form,
          route.sharedPath,
        ]),
      ).toEqual([
        [
          "post",
          "/api/evaluations/batch/log_results",
          "postApiEvaluationsBatchLogResults",
          "evaluations:manage",
          "protocol",
          "text",
          undefined,
        ],
      ]);
    });

    /** @scenario "The batch log route reads a body up to the largest limit any organization holds" */
    it("caps the batch log at the ceiling an organization can be raised to", () => {
      const [route] = declaration.routes;

      expect(route?.bodyLimit?.maxBytes).toBe(DATASET_CEILING_LIMITS.rowBytes);
      expect(DATASET_CEILING_LIMITS.rowBytes).toBeGreaterThan(DATASET_DEFAULT_LIMITS.rowBytes);
    });

    /** @scenario "The batch log route reads a body up to the largest limit any organization holds" */
    it("refuses a body past the ceiling by the batch log's own code", () => {
      const [route] = declaration.routes;

      expect(route?.bodyLimit?.onExceeded?.()).toMatchObject({
        code: "evaluation_log_results_too_large",
        httpStatus: 413,
        meta: { maxBytes: DATASET_CEILING_LIMITS.rowBytes },
      });
    });
  });
});
