/**
 * @vitest-environment node
 * The family's addresses, operation ids, door and access kinds, pinned.
 * @see specs/monitors/guardrails-api-compatibility.feature
 */
import { describe, expect, it } from "vitest";

import { evaluationsLegacyRest } from "../evaluations-legacy.rest.ts";

const declaration = evaluationsLegacyRest.router();

const CREDENTIALED = [
  "postApiEvaluationsBatchLogResults",
  "postApiEvaluationsByEvaluatorEvaluate",
  "postApiEvaluationsByEvaluatorBySubpathEvaluate",
  "postApiGuardrailsByEvaluatorEvaluate",
  "postApiDatasetEvaluate",
];

describe("the public evaluation REST family", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the family's namespace, its literal addressing and its /api/v1 twin", () => {
      expect(evaluationsLegacyRest.namespace).toBe("evaluations-legacy");
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(true);
    });

    it("answers behind a project API key", () => {
      expect(declaration.credential).toBe("project");
    });

    it("keeps every path, method and operation id", () => {
      expect(
        declaration.routes.map((route) => [route.method, route.path, route.operation]),
      ).toEqual([
        ["get", "/api/evaluations/list", "getApiEvaluationsList"],
        [
          "post",
          "/api/evaluations/batch/log_results",
          "postApiEvaluationsBatchLogResults",
        ],
        [
          "post",
          "/api/evaluations/:evaluator/evaluate",
          "postApiEvaluationsByEvaluatorEvaluate",
        ],
        [
          "post",
          "/api/evaluations/:evaluator/:subpath/evaluate",
          "postApiEvaluationsByEvaluatorBySubpathEvaluate",
        ],
        ["post", "/api/guardrails/:evaluator/evaluate", "postApiGuardrailsByEvaluatorEvaluate"],
        ["post", "/api/dataset/evaluate", "postApiDatasetEvaluate"],
      ]);
    });

    it("leaves the catalogue open to any caller and takes no credential for it", () => {
      const catalogue = declaration.routes[0];

      expect(catalogue?.access?.kind).toBe("public");
      expect(catalogue?.permission).toBeUndefined();
    });

    it("asks evaluations:manage of every other route", () => {
      const guarded = declaration.routes.filter((route) => CREDENTIALED.includes(route.operation));

      expect(guarded).toHaveLength(CREDENTIALED.length);

      for (const route of guarded) {
        expect([route.operation, route.permission]).toEqual([
          route.operation,
          "evaluations:manage",
        ]);
      }
    });

    it("reads its own body and writes its own answer on every route", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.rawResponse !== undefined]).toEqual([route.operation, true]);
      }

      for (const route of declaration.routes.filter((one) => one.method === "post")) {
        expect([route.operation, route.rawBody?.form]).toEqual([route.operation, "text"]);
      }
    });

    it("caps the batch log at 20MB and every evaluate door at 30MB", () => {
      const caps = Object.fromEntries(
        declaration.routes.map((route) => [route.operation, route.bodyLimit?.maxBytes]),
      );

      expect(caps.postApiEvaluationsBatchLogResults).toBe(20 * 1024 * 1024);
      expect(caps.postApiEvaluationsByEvaluatorEvaluate).toBe(30 * 1024 * 1024);
      expect(caps.postApiEvaluationsByEvaluatorBySubpathEvaluate).toBe(30 * 1024 * 1024);
      expect(caps.postApiGuardrailsByEvaluatorEvaluate).toBe(30 * 1024 * 1024);
      expect(caps.postApiDatasetEvaluate).toBe(30 * 1024 * 1024);
    });
  });
});
