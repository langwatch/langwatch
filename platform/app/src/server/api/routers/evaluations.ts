/**
 * Process wiring for the `evaluations.*` tRPC surface.
 *
 * The transport itself is package-owned — `EvaluationTrpcApi` in
 * `@langwatch/evaluation-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its authenticated procedure, its
 * authorization middlewares, the client the custom-evaluator read runs on, and
 * the adapters behind every port the evaluation package declares — the
 * trace-mapping registry, the project's Azure Safety credentials, this
 * install's evaluator inventory and environment, the trace evaluation runner,
 * product analytics, and the evaluator runtime's keep-alive probe.
 *
 * Spec: specs/evaluators/azure-safety-byok-gating.feature.
 */
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { createEvaluationTrpcRouter, declaredCheckFrom } from "@langwatch/platform-api/app-trpc";
import { studioBackendPostEvent } from "~/app/api/workflows/post_event/post-event";
import type { TRPCContext } from "~/server/api/trpc.context";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { prisma } from "~/server/db";
import { trackServerEvent } from "~/server/posthog";
import { getAzureSafetyEnvFromProject } from "../../app-layer/evaluations/azure-safety-env.server";
import { evaluatorUnavailability } from "../../evaluations/installedEvaluators";
import { runEvaluationForTrace } from "../../evaluations/runEvaluation";
import { mappingStateSchema } from "../../tracer/tracesMapping";
import { appTrpcRoot } from "../trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "../trpc.runtime-policy";
import { scopeLineageGuard } from "../trpc.scope-lineage-middleware";
import { getUserProtectionsForProject } from "../utils";

/** This process's concrete policy chain, in the order the mount applies it. */
const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: tracerMiddleware,
  logger: loggerMiddleware,
  handledError: handledErrorMiddleware,
  scopeLineageGuard,
  declaredCheck: declaredCheckFrom({
    permission: checkDeclaredPermission,
    permissionAny: checkDeclaredPermissionAny,
    noPermission: declaredNoPermission,
    serviceAuthorized: declaredServiceAuthorization,
  }),
  enforceCheck: enforcePermissionCheck,
  auditMutations: auditLogMutations,
};

export const evaluationsRouter = createEvaluationTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  prisma,
  ports: {
    mappingsSchema: mappingStateSchema,

    /**
     * Azure Safety evaluators resolve their credentials solely from the
     * project's `azure_safety` Model Provider. There is no `process.env`
     * fallback, so an unconfigured provider deterministically resolves null
     * and the package reports every Azure variable as missing.
     */
    tryResolveAzureSafetyEnv: (ctx: TRPCContext, { projectId }) =>
      getAzureSafetyEnvFromProject(ctx.app.modelProviders, projectId),

    evaluatorUnavailability,
    missingEnvironmentVariables: (envVars) => envVars.filter((envVar) => !process.env[envVar]),

    runEvaluationForTrace: async (ctx: TRPCContext, input) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      return runEvaluationForTrace({
        projectId: input.projectId,
        traceId: input.traceId,
        evaluatorType: input.evaluatorType,
        settings: input.settings,
        mappings: input.mappings,
        protections,
        evaluations: ctx.app.evaluations,
        modelProviders: ctx.app.modelProviders,
        managedProviders: ctx.app.managedProviders,
        workflows: ctx.app.workflows,
        evaluators: ctx.app.evaluators,
        traceCanonicalisation: ctx.app.traces.canonicalisation,
      });
    },

    trackEvaluationRan: ({ userId, projectId }) => {
      trackServerEvent({ userId, event: "evaluation_ran", projectId });
    },

    sendKeepAliveProbe: async (ctx: TRPCContext, { projectId }) => {
      await studioBackendPostEvent({
        projectId,
        nlpLambda: ctx.app.nlpLambda,
        modelProviders: ctx.app.modelProviders,
        message: { type: "is_alive", payload: {} },
        onEvent: () => {
          // Response received - lambda is warm
        },
      });
    },
  },
});
