/**
 * The addresses, methods, permissions, operation ids and statuses the Instant
 * Evals REST family publishes at `/api/v1/instant-evals`.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { instantEvalRest } from "../instant-eval.rest.ts";

describe("given the Instant Evals REST family", () => {
  const declaration = instantEvalRest.router();

  describe("when its addressing is read", () => {
    it("names its generation first, so a consumer learns one rule for where v1 lives", () => {
      expect({ namespace: declaration.namespace, addressing: declaration.addressing }).toEqual({
        namespace: "instant-evals",
        addressing: "v1-only",
      });
    });
  });

  describe("when its routes are read", () => {
    it("publishes the seven endpoints a caller drives a run with, spending behind manage", () => {
      expect(
        declaration.routes.map((route) => ({
          method: route.method,
          path: route.path,
          operation: route.operation,
          permission: route.permission,
        })),
      ).toEqual([
        {
          method: "post",
          path: "/",
          operation: "createInstantEvalRun",
          permission: "analytics:manage",
        },
        {
          method: "post",
          path: "/estimate",
          operation: "estimateInstantEvalRun",
          permission: "analytics:manage",
        },
        {
          method: "get",
          path: "/",
          operation: "listInstantEvalRuns",
          permission: "analytics:view",
        },
        {
          method: "get",
          path: "/:id",
          operation: "getInstantEvalRun",
          permission: "analytics:view",
        },
        {
          method: "post",
          path: "/:id/cancel",
          operation: "cancelInstantEvalRun",
          permission: "analytics:manage",
        },
        {
          method: "get",
          path: "/:id/results",
          operation: "listInstantEvalRunResults",
          permission: "analytics:view",
        },
        {
          method: "get",
          path: "/:id/sample",
          operation: "sampleInstantEvalRun",
          permission: "analytics:view",
        },
      ]);
    });

    it("answers the create with 202, because the judging is the queue's and not the request's", () => {
      const created = declaration.routes.find(
        (route) => route.operation === "createInstantEvalRun",
      );

      expect(created?.status).toBe(202);
    });

    it("asks the process for the request's credential wherever a run reads rows", () => {
      expect(
        declaration.routes.map((route) => ({
          operation: route.operation,
          facts: (route.middleware ?? []).map((middleware) => middleware.name),
        })),
      ).toEqual([
        { operation: "createInstantEvalRun", facts: ["instantEvalRestCredential"] },
        { operation: "estimateInstantEvalRun", facts: ["instantEvalRestCredential"] },
        { operation: "listInstantEvalRuns", facts: [] },
        { operation: "getInstantEvalRun", facts: [] },
        { operation: "cancelInstantEvalRun", facts: [] },
        { operation: "listInstantEvalRunResults", facts: [] },
        { operation: "sampleInstantEvalRun", facts: ["instantEvalRestCredential"] },
      ]);
    });
  });
});
