/**
 * The process policy this mount wraps around the package-owned evaluation
 * transport. The proof it carries is that mounting changed nothing a caller
 * can observe: the same four procedure names, the same declared permission on
 * each one, and — the load-bearing one — that every middleware in the chain
 * sees the VALIDATED input.
 *
 * That last assertion is the whole hazard of this shape. tRPC appends the
 * input parser where `.input()` is called, so a policy composed ahead of it
 * hands the authorization check, the scope-lineage guard and the audit row
 * `input === undefined` — and all three then pass while reporting green.
 */
import {
  authzDeclarationOf,
  declareAuthzMiddleware,
  type AuthzDeclaration,
} from "@langwatch/authz-contract";
import type { EvaluationRunOutcome } from "@langwatch/evaluation-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { createEvaluationTrpcRouter } from "../evaluation-trpc.mount";

const PROJECT_ID = "project_evaluation_mount";
const USER_ID = "user_evaluation_mount";

const mappingsSchema = z.object({
  mapping: z.record(z.string(), z.unknown()),
  expansions: z.array(z.string()),
});

type TestContext = {
  app: { evaluations: { reportEvaluation(data: unknown): Promise<unknown> } };
  actor(): { id: string };
  session: { user: { id: string } } | null;
};

const PROCESSED_RESULT = {
  status: "processed",
  score: 1,
  passed: true,
} as unknown as EvaluationRunOutcome;

function declarationsOf(router: unknown): Record<string, AuthzDeclaration | null> {
  const procedures = (router as { _def: { procedures: Record<string, unknown> } })._def.procedures;

  return Object.fromEntries(
    Object.entries(procedures).map(([path, procedure]) => {
      const middlewares =
        (procedure as { _def?: { middlewares?: unknown[] } })._def?.middlewares ?? [];
      const declared =
        middlewares
          .map((middleware) => authzDeclarationOf(middleware))
          .find((found) => found !== null) ?? null;
      return [path, declared];
    }),
  );
}

function harness() {
  const trpc = initTRPC.context<TestContext>().create();
  /** What each middleware in the chain saw, in the order they ran. */
  const seen: { name: string; input: unknown }[] = [];

  const record =
    (name: string) =>
    ({ input, next }: { input: unknown; next: () => Promise<unknown> }) => {
      seen.push({ name, input });
      return next();
    };

  const middlewares: AppTrpcPolicyMiddlewares = {
    tracer: record("tracer"),
    logger: record("logger"),
    handledError: record("handledError"),
    scopeLineageGuard: () => record("scopeLineageGuard"),
    declaredCheck: (declaration) =>
      declareAuthzMiddleware(
        declaration,
        record("declaredCheck") as unknown as (params: never) => Promise<unknown>,
      ),
    enforceCheck: record("enforceCheck"),
    auditMutations: record("auditMutations"),
  };

  const findMany = vi.fn(async () => [
    { id: "workflow_1", publishedId: "version_1", versions: [{ id: "version_1" }] },
  ]);
  const prisma = { workflow: { findMany } } as unknown as PrismaClient;

  const router = createEvaluationTrpcRouter({
    root: trpc,
    protectedProcedure: trpc.procedure.use(({ ctx, next }) => {
      if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
      return next({ ctx: { session: { user: ctx.session.user } } });
    }),
    middlewares,
    prisma,
    ports: {
      mappingsSchema,
      tryResolveAzureSafetyEnv: async () => null,
      evaluatorUnavailability: () => undefined,
      missingEnvironmentVariables: () => [],
      runEvaluationForTrace: async () => PROCESSED_RESULT,
      trackEvaluationRan: () => {},
      sendKeepAliveProbe: async () => {},
    },
  });

  return {
    router,
    seen,
    findMany,
    caller: router.createCaller({
      app: { evaluations: { reportEvaluation: async () => undefined } },
      actor: () => ({ id: USER_ID }),
      session: { user: { id: USER_ID } },
    }),
  };
}

describe("evaluation transport mount", () => {
  describe("given the mounted router", () => {
    /** @scenario "The evaluation transport moves without changing who may call it" */
    it("keeps the legacy procedure names the browser calls", () => {
      const { router } = harness();

      expect(
        Object.keys(
          (router as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
        ).sort(),
      ).toEqual([
        "availableCustomEvaluators",
        "availableEvaluators",
        "runEvaluation",
        "warmupLambda",
      ]);
    });

    /** @scenario "The evaluation transport moves without changing who may call it" */
    it("declares the same permission on every procedure", () => {
      const { router } = harness();

      expect(declarationsOf(router)).toEqual({
        availableEvaluators: { kind: "permission", permission: "evaluations:view" },
        availableCustomEvaluators: { kind: "permission", permission: "evaluations:view" },
        runEvaluation: { kind: "permission", permission: "evaluations:manage" },
        warmupLambda: { kind: "permission", permission: "evaluations:view" },
      });
    });
  });

  describe("when a permitted caller reads the project's evaluators", () => {
    /** @scenario "The declared check reads the validated input" */
    it("hands every middleware the project the validated input named", async () => {
      const { caller, seen } = harness();

      await caller.availableEvaluators({ projectId: PROJECT_ID });

      expect(seen.map((entry) => entry.name)).toEqual([
        "tracer",
        "logger",
        "handledError",
        "scopeLineageGuard",
        "declaredCheck",
        "enforceCheck",
        "auditMutations",
      ]);
      // Every one of them, not just the first: the policy is applied AFTER the
      // feature's own `.input()`, so none of them can see `undefined`.
      for (const entry of seen) {
        expect(entry.input).toEqual({ projectId: PROJECT_ID });
      }
    });
  });

  describe("when the client asks for the project's custom evaluators", () => {
    it("reads the project's evaluator workflows and keeps only the published version", async () => {
      const { caller, findMany } = harness();

      const result = await caller.availableCustomEvaluators({ projectId: PROJECT_ID });

      expect(findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID, isEvaluator: true },
        include: { versions: true },
      });
      expect(result).toEqual([
        { id: "workflow_1", publishedId: "version_1", versions: [{ id: "version_1" }] },
      ]);
    });
  });

  describe("when the caller has no session", () => {
    it("refuses before the evaluator list is built", async () => {
      const { router } = harness();
      const caller = router.createCaller({
        app: { evaluations: { reportEvaluation: async () => undefined } },
        actor: () => ({ id: USER_ID }),
        session: null,
      });

      await expect(caller.availableEvaluators({ projectId: PROJECT_ID })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });
});
