/**
 * @vitest-environment node
 * The dataset evaluation door's address, operation id, door and access kind,
 * pinned to what it answered while evaluation served it.
 * @see modules/experiment/specs/experiment-dataset-evaluation.feature
 */
import { describe, expect, it } from "vitest";

import { experimentDatasetEvaluationRest } from "../experiment-dataset-evaluation.rest.ts";

const declaration = experimentDatasetEvaluationRest.router();

describe("the SDK dataset evaluation REST family", () => {
  describe("given the declaration experiment mounts", () => {
    /** @scenario "The dataset evaluation door keeps its wire after the move" */
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
          route.sharedPath?.owner,
        ]),
      ).toEqual([
        [
          "post",
          "/api/dataset/evaluate",
          "postApiDatasetEvaluate",
          "evaluations:manage",
          "protocol",
          "text",
          "dataset",
        ],
      ]);
    });

    /** @scenario "The dataset evaluation door keeps its wire after the move" */
    it("caps the body at 30MB and refuses past it with payload_too_large", () => {
      const [route] = declaration.routes;

      expect(route?.bodyLimit?.maxBytes).toBe(30 * 1024 * 1024);
      expect(route?.bodyLimit?.onExceeded?.()).toMatchObject({ code: "payload_too_large" });
    });
  });
});
