/**
 * @vitest-environment node
 * The binding half of `evaluations.*`: the wire names and the access decision
 * each declares, read off the declaration rather than off a mount.
 */
import type { TrpcProcedureFactory, TrpcProcedureRequest } from "@langwatch/api/trpc";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { evaluationTrpcTransport } from "../evaluation.trpc.ts";

/** Every procedure the declaration asks a runtime to build, with its decision. */
function declaredAccess(): Record<string, unknown> {
  const declared: Record<string, unknown> = {};
  const factory: TrpcProcedureFactory<{ evaluations: EvaluationApi }> = {
    procedure(request: TrpcProcedureRequest<{ evaluations: EvaluationApi }>) {
      declared[request.procedure] = request.access;

      return request.procedure;
    },
    router: (record) => record,
  };

  evaluationTrpcTransport.router(factory, (context) => context.evaluations);

  return declared;
}

describe("given the evaluations tRPC transport", () => {
  describe("when a process mounts it on its own root", () => {
    /** @scenario "The evaluation transport moves without changing who may call it" */
    it("keeps the procedure names the browser calls and the decision each declares", () => {
      expect(declaredAccess()).toEqual({
        "evaluations.availableEvaluators": {
          kind: "permission",
          permission: "evaluations:view",
        },
        "evaluations.availableCustomEvaluators": {
          kind: "permission",
          permission: "evaluations:view",
        },
        "evaluations.runEvaluation": { kind: "permission", permission: "evaluations:manage" },
        "evaluations.warmupLambda": { kind: "permission", permission: "evaluations:view" },
      });
    });

    it("mounts under the namespace the browser caches by", () => {
      expect(evaluationTrpcTransport.namespace).toBe("evaluations");
    });
  });
});
