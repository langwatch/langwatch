/**
 * The one list, proved to be one list.
 *
 * Two things are pinned here. The first is membership: every namespace the app
 * process serves from this package is built by iterating this record, so a
 * surface that drops out of it stops being mounted — and stops being visible
 * to the declaration sweep — in the same edit. A key that disappears without
 * anyone noticing is exactly the failure the record exists to prevent.
 *
 * The second is that the record hands back the PACKAGED transports rather than
 * something assembled here: each entry is read for the procedure names its
 * feature package defines. A wrapper that quietly built its own router would
 * pass a "the key is present" assertion and fail this one.
 *
 * Nothing in this suite serves a request. The mount is a bare tRPC root and
 * every port refuses, because building a surface is what registers its access
 * decisions — the part the audits read.
 */
import type {
  AnnotationScoreTrpcContext,
  AnnotationTrpcContext,
  AnnotationTrpcPorts,
} from "@langwatch/annotation-server";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import type { ApiKeyTrpcContext } from "@langwatch/api-key-server";
import type { FrontDoorTrpcContext, PublicEnvTrpcContext } from "@langwatch/auth-server";
import { declareAuthzMiddleware } from "@langwatch/authz-contract";
import type { DashboardTrpcContext, GraphTrpcContext } from "@langwatch/dashboard-server";
import type { EvaluationTrpcContext } from "@langwatch/evaluation-server";
import type { ExperimentTrpcContext } from "@langwatch/experiment-server";
import type { GroupTrpcContext, JoinRequestTrpcContext } from "@langwatch/organization-server";
import type { IdentityTrpcContext } from "@langwatch/user-server";
import type {
  WorkflowOptimizationTrpcContext,
  WorkflowTrpcContext,
} from "@langwatch/workflow-server";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAppTrpcFeatures, type AppTrpcFeaturePorts } from "../app-trpc.features";

/**
 * The intersection every mounted surface constrains the process's context to.
 * Stating it here is what makes a feature whose context grows a compile error
 * in this suite rather than a surprise in the app.
 */
type TestContext = AnnotationTrpcContext &
  AnnotationScoreTrpcContext &
  ApiKeyTrpcContext &
  DashboardTrpcContext &
  EvaluationTrpcContext &
  ExperimentTrpcContext &
  FrontDoorTrpcContext &
  GraphTrpcContext &
  GroupTrpcContext &
  IdentityTrpcContext &
  JoinRequestTrpcContext &
  PublicEnvTrpcContext &
  WorkflowOptimizationTrpcContext &
  WorkflowTrpcContext;

/** A pass-through stand-in for one of the process's policy middlewares. */
const passThrough =
  () =>
  ({ next }: { next: () => Promise<unknown> }) =>
    next();

const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: passThrough(),
  logger: passThrough(),
  handledError: passThrough(),
  scopeLineageGuard: () => passThrough(),
  // The real one attaches the declaration to the middleware it builds, which
  // is what the declaration sweep reads back off a mounted procedure.
  declaredCheck: (declaration) =>
    declareAuthzMiddleware(
      declaration,
      passThrough() as unknown as (params: never) => Promise<unknown>,
    ),
  enforceCheck: passThrough(),
  auditMutations: passThrough(),
};

/**
 * Every port refuses when called.
 *
 * Three are real Zod schemas rather than refusals, because those three are
 * read while the surface is being BUILT — they become the procedures' input
 * parsers — so a refusal there could not be mounted at all.
 */
function refusingPorts(): AppTrpcFeaturePorts<
  AnnotationTrpcPorts,
  string,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>
> {
  const refuse = (what: string) => (): never => {
    throw new Error(`${what} was reached while building the feature list`);
  };

  const refuseEvery = (what: string) =>
    new Proxy({}, { get: (_target, member) => refuse(`${what}.${String(member)}`) }) as never;

  return {
    annotation: refuseEvery("annotation"),
    apiKeyAudit: refuse("apiKeyAudit"),
    auth: refuseEvery("auth"),
    evaluations: {
      ...(refuseEvery("evaluations") as object),
      mappingsSchema: z.object({ mapping: z.record(z.string(), z.unknown()) }),
    } as never,
    experiments: {
      ...(refuseEvery("experiments") as object),
      workbenchStateSchema: z.object({ rows: z.array(z.unknown()) }),
    } as never,
    graphs: {
      ...(refuseEvery("graphs") as object),
      filterFieldSchema: z.enum(["metadata.user_id"]),
    } as never,
    group: refuseEvery("group"),
    identity: refuseEvery("identity"),
    joinRequests: refuseEvery("joinRequests"),
    prisma: refuseEvery("prisma"),
    workflows: {
      lifecycle: refuseEvery("workflows.lifecycle"),
      optimization: refuseEvery("workflows.optimization"),
    },
  };
}

function buildFeatures() {
  const trpc = initTRPC.context<TestContext>().create();

  return createAppTrpcFeatures({
    mount: {
      root: trpc,
      protectedProcedure: trpc.procedure,
      publicProcedure: trpc.procedure,
      middlewares,
    },
    ports: refusingPorts(),
  });
}

/** The procedure paths one mounted router answers on. */
const procedureNamesOf = (router: unknown): string[] =>
  Object.keys((router as { _def: { procedures: Record<string, unknown> } })._def.procedures).sort();

describe("the app tRPC feature list", () => {
  describe("given one process mount", () => {
    it("builds every namespace the app process serves from this package", () => {
      expect(Object.keys(buildFeatures()).sort()).toEqual([
        "annotation",
        "annotationScore",
        "apiKey",
        "dashboards",
        "evaluations",
        "experiments",
        "frontDoor",
        "graphs",
        "group",
        "identity",
        "joinRequests",
        "optimization",
        "publicEnv",
        "workflow",
      ]);
    });

    it("hands back the packaged transport for each namespace, procedure names intact", () => {
      const features = buildFeatures();

      expect(procedureNamesOf(features.annotationScore)).toEqual([
        "delete",
        "getAll",
        "getAllActive",
        "getById",
        "toggle",
        "upsert",
      ]);
      expect(procedureNamesOf(features.apiKey)).toEqual([
        "create",
        "list",
        "myBindings",
        "nameById",
        "orgMembers",
        "orgProjects",
        "orgTeams",
        "revoke",
        "update",
      ]);
      expect(procedureNamesOf(features.identity)).toEqual(["completeVerification"]);
      // Two namespaces for one feature, and the studio's own is not a subset of
      // the lifecycle's: naming both is what would catch either being dropped.
      expect(procedureNamesOf(features.optimization)).toEqual([
        "chat",
        "disableAsComponent",
        "disableAsEvaluator",
        "getComponents",
        "getPublishedWorkflow",
        "toggleSaveAsComponent",
        "toggleSaveAsEvaluator",
      ]);
    });

    it("mounts publicEnv as a bare procedure, because that is the name the client calls", () => {
      const publicEnv = buildFeatures().publicEnv as { _def: { type: string; procedure: boolean } };

      expect(publicEnv._def.procedure).toBe(true);
      expect(publicEnv._def.type).toBe("query");
    });

    it("leaves no namespace without procedures", () => {
      const features = buildFeatures();
      const routers = Object.entries(features).filter(([name]) => name !== "publicEnv");

      for (const [name, router] of routers) {
        expect({ name, procedures: procedureNamesOf(router).length > 0 }).toEqual({
          name,
          procedures: true,
        });
      }
    });
  });
});
