/**
 * The experiment wire, pinned. Twenty tRPC procedures and five REST routes,
 * each with the name, the kind and the permission it answered on `origin/main`
 * before the transports were rewritten against the declaration builders. A
 * rename here is a cache-key change in every browser that calls it and a
 * breaking change in every SDK that posts to it.
 *
 * Spec: modules/experiment/specs/experiment-service.feature.
 */
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { experimentsTrpc } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import { experimentDspyStepsRest } from "../experiment-dspy-steps.rest.ts";
import { experimentInitRest } from "../experiment-init.rest.ts";
import { experimentRest } from "../experiment.rest.ts";
import { experimentTrpcTransport } from "../experiment.trpc.ts";

/** Records the access each declared procedure asked for, building nothing. */
function accessDeclaredBy(declaration: {
  router(runtime: TrpcProcedureFactory<object>, app: (ctx: object) => never): unknown;
}): (AuthzPermission | AuthzDeclaration)[] {
  const declared: (AuthzPermission | AuthzDeclaration)[] = [];
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access }) => {
      declared.push(access.kind === "permission" ? access.permission : access);

      return {};
    },
    router: (record) => record,
  };

  declaration.router(runtime, () => {
    throw new Error("This test mounts but never handles a request");
  });

  return declared;
}

/** Name, kind and permission, as `origin/main`'s `experimentsRouter` had them. */
const MAIN_PROCEDURES = [
  ["saveExperiment", "mutation", "workflows:create"],
  ["saveEvaluationsV3", "mutation", "experiments:update"],
  ["getEvaluationsV3BySlug", "query", "experiments:view"],
  ["getWorkbenchVersion", "query", "experiments:view"],
  ["onExperimentUpdate", "subscription", "experiments:view"],
  ["listWorkbenchVersions", "query", "experiments:view"],
  ["commitWorkbenchVersion", "mutation", "experiments:update"],
  ["restoreWorkbenchVersion", "mutation", "experiments:update"],
  ["saveAsMonitor", "mutation", "workflows:create"],
  ["getExperimentBySlugOrId", "query", "experiments:view"],
  ["getExperimentWithDSLBySlug", "query", "experiments:view"],
  ["getAllByProjectId", "query", "experiments:view"],
  ["getAllForEvaluationsList", "query", "experiments:view"],
  ["getLastExperiment", "query", "experiments:view"],
  ["deleteExperiment", "mutation", "workflows:delete"],
  ["copy", "mutation", "evaluations:manage"],
  ["getExperimentDSPyRuns", "query", "experiments:view"],
  ["getExperimentDSPyStep", "query", "experiments:view"],
  ["getExperimentBatchEvaluationRuns", "query", "experiments:view"],
  ["getExperimentBatchEvaluationRun", "query", "experiments:view"],
] as const;

describe("given the experiments tRPC namespace", () => {
  describe("when the declaration is read", () => {
    it("declares the same twenty procedures, in the same kinds, as before the rewrite", () => {
      expect(
        Object.entries(experimentsTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual(MAIN_PROCEDURES.map(([name, kind]) => [name, kind]));
    });

    it("answers under the namespace the browser has always called", () => {
      expect(experimentsTrpc.namespace).toBe("experiments");
    });

    it("declares an output for every procedure except the monitor publication", () => {
      const withoutOutput = Object.entries(experimentsTrpc.members)
        .filter(([, member]) => member.output === undefined)
        .map(([name]) => name);

      expect(withoutOutput).toEqual(["saveAsMonitor"]);
    });
  });

  describe("when the server half is mounted", () => {
    it("binds every declared procedure once, on the permission it answered before", () => {
      expect(
        Object.keys(experimentsTrpc.members).map((name, index) => [
          name,
          accessDeclaredBy(experimentTrpcTransport)[index],
        ]),
      ).toEqual(MAIN_PROCEDURES.map(([name, , permission]) => [name, permission]));
    });
  });
});

describe("given the experiment REST families", () => {
  describe("when their declarations are read", () => {
    it("answers under the paths the SDKs and the published document already name", () => {
      expect([
        experimentRest.namespace,
        experimentInitRest.namespace,
        experimentDspyStepsRest.namespace,
      ]).toEqual(["experiments", "experiment", "dspy"]);
    });

    it("keeps the three experiment routes on their own permissions", () => {
      expect(
        experimentRest
          .router()
          .routes.map(({ method, path, operation }) => [method, path, operation]),
      ).toEqual([
        ["get", "/", "listExperiments"],
        ["get", "/:slug", "getExperiment"],
        ["post", "/", "createExperiment"],
      ]);
    });

    it("keeps the two SDK doors on the one literal path each has always answered at", () => {
      expect([
        ...experimentInitRest.router().routes.map(({ method, path }) => `${method} /api/experiment${path}`),
        ...experimentDspyStepsRest.router().routes.map(({ method, path }) => `${method} /api/dspy${path}`),
      ]).toEqual(["post /api/experiment/init", "post /api/dspy/log_steps"]);
    });
  });
});
