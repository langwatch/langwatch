/**
 * Process wiring for the `experiments.*` tRPC surface.
 *
 * The transport itself is package-owned — `ExperimentTrpcApi` in
 * `@langwatch/experiment-server`, mounted through
 * `@langwatch/platform-api/app-trpc`. What is left here is the composition
 * this application still owns: its tRPC root, its authenticated procedure, its
 * authorization middlewares, and the workflow, monitor and identity
 * collaborators an experiment still reaches through the application while
 * those verticals are drained.
 */
import {
  createExperimentTrpcRouter,
  declaredCheckFrom,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/platform-api/app-trpc";
import type { StudioWorkflow } from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { slugify } from "../../../utils/slugify";
import { workbenchStateSchema } from "../../experiments-v3/legacy-workbench.schema";
import { coerceMonitorMappings } from "../../tracer/tracesMapping";
import type { TRPCContext } from "../trpc.context";
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
import { copyWorkflowWithDatasets, saveOrCommitWorkflowVersion } from "./workflows";

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

/**
 * The request context the workflow helpers resolve their work from. They read
 * the session and the process's own workflow and model-provider services, so
 * they are handed the whole context rather than pieces of it.
 */
type WorkflowHelperContext = Parameters<typeof saveOrCommitWorkflowVersion>[0]["ctx"];

export const experimentsRouter = createExperimentTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    workbenchStateSchema,
    slugify,
    probeProjectPermission: (ctx, projectId, permission) =>
      probeProjectPermission(ctx as unknown as TRPCContext, projectId, permission),
    saveWorkflowVersion: (ctx, input) =>
      saveOrCommitWorkflowVersion({
        ctx: ctx as unknown as WorkflowHelperContext,
        input: {
          projectId: input.projectId,
          workflowId: input.workflowId,
          dsl: input.dsl,
        },
        autoSaved: input.autoSaved,
        commitMessage: input.commitMessage,
        ...(input.setAsLatestVersion === undefined
          ? {}
          : { setAsLatestVersion: input.setAsLatestVersion }),
      }),
    copyWorkflowWithDatasets: (ctx, input) =>
      copyWorkflowWithDatasets({
        ctx: ctx as unknown as Parameters<typeof copyWorkflowWithDatasets>[0]["ctx"],
        workflow: {
          ...input.workflow,
          latestVersion: input.workflow.latestVersion
            ? { dsl: input.workflow.latestVersion.dsl as StudioWorkflow }
            : null,
        },
        targetProjectId: input.targetProjectId,
        sourceProjectId: input.sourceProjectId,
        ...(input.copyDatasets === undefined ? {} : { copyDatasets: input.copyDatasets }),
        ...(input.copiedFromWorkflowId === undefined
          ? {}
          : { copiedFromWorkflowId: input.copiedFromWorkflowId }),
      }),
    createWorkflow: async (ctx, input) =>
      await (ctx as unknown as TRPCContext).prisma.workflow.create({
        data: {
          id: `workflow_${nanoid()}`,
          projectId: input.projectId,
          name: input.name,
          icon: input.icon ?? null,
          description: input.description ?? null,
        },
      }),
    tryFindWorkflow: async (ctx, input) =>
      await (ctx as unknown as TRPCContext).prisma.workflow.findFirst({
        where: { id: input.workflowId, projectId: input.projectId },
      }),
    coerceMonitorMappings,
    upsertExperimentMonitor: async (ctx, { projectId, experimentId, monitor }) => {
      const monitorData = {
        name: monitor.name,
        checkType: monitor.checkType,
        slug: monitor.slug,
        preconditions: monitor.preconditions as object,
        parameters: monitor.parameters as Record<string, unknown>,
        mappings: monitor.mappings as object,
        sample: monitor.sample,
        enabled: monitor.enabled,
        executionMode: monitor.executionMode as "ON_MESSAGE",
      };

      return await (ctx as unknown as TRPCContext).prisma.monitor.upsert({
        where: { experimentId, projectId },
        update: monitorData,
        create: {
          ...monitorData,
          id: `monitor_${nanoid()}`,
          projectId,
          experimentId,
        },
      });
    },
    resolveAuthorNames: async (ctx, authorIds) =>
      await (ctx as unknown as TRPCContext).prisma.user.findMany({
        where: { id: { in: [...authorIds] } },
        select: { id: true, name: true },
      }),
  },
});
