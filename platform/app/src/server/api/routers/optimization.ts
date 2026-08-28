/**
 * Process composition for the package-owned `optimization.*` tRPC surface.
 *
 * Behaviour, procedure names and schemas live in
 * `@langwatch/workflow-server` — the optimization studio's procedures are
 * workflow procedures, and `workflow` is the feature that owns them. This
 * supplies the process's tRPC root, its policy chain and the workflow rows the
 * two publication flags are still written on directly.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { WorkflowOptimizationTrpcApi } from "@langwatch/workflow-server";
import { checkDeclaredPermission } from "~/server/app-layer/authz/trpc-middleware";
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

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to the feature package, so the policy below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * Exactly the chain `protectedProcedure.input(…).permission(…)` builds, handed
 * to the feature so it applies the policy AFTER its own input parser: tRPC runs
 * middlewares in the order they were added, and the declared check reads its
 * scope id from the validated input. `checkDeclaredPermission` carries the
 * authz declaration the router sweep reads, so these procedures stay declared.
 */
const policy =
  (permission: AuthzPermission) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure)
      .use(tracerMiddleware)
      .use(loggerMiddleware)
      .use(handledErrorMiddleware)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before the declaration can pass on one id
      // while the handler acts on another.
      .use(scopeLineageGuard({ kind: "permission", permission }))
      .use(checkDeclaredPermission({ permission }))
      .use(enforcePermissionCheck)
      .use(auditLogMutations) as unknown as TProcedure;

const appContext = (ctx: unknown) => ctx as TRPCContext;

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const optimizationRouter = WorkflowOptimizationTrpcApi.create(
  appTrpcRoot,
  { protected: authProtectedProcedure, policy },
  {
    // The studio's chat panel runs the workflow over the same public run
    // endpoint an external caller uses, authenticated as the project.
    runPublishedWorkflow: async (ctx, input) => {
      const project = await appContext(ctx).prisma.project.findFirst({
        where: { id: input.projectId },
      });

      const apiKey = project?.apiKey;

      const response = await fetch(
        `${process.env.BASE_HOST}/api/workflows/${input.workflowId}/run`,
        {
          method: "POST",
          body: JSON.stringify(input.body),
          headers: {
            "Content-Type": "application/json",
            ...(apiKey && { "x-auth-token": apiKey }),
          },
        },
      );

      return await response.json();
    },
    tryGetWorkflow: async (ctx, input) =>
      await appContext(ctx).prisma.workflow.findFirst({
        where: { id: input.workflowId, projectId: input.projectId },
      }),
    tryGetWorkflowVersion: async (ctx, input) =>
      await appContext(ctx).prisma.workflowVersion.findFirst({
        where: { id: input.versionId, projectId: input.projectId },
      }),
    setWorkflowFlags: async (ctx, input) => {
      await appContext(ctx).prisma.workflow.update({
        where: { id: input.workflowId, projectId: input.projectId },
        data: {
          ...(input.isComponent === undefined ? {} : { isComponent: input.isComponent }),
          ...(input.isEvaluator === undefined ? {} : { isEvaluator: input.isEvaluator }),
        },
      });
    },
    listPublishedComponents: async (ctx, input) => {
      const workflows = await appContext(ctx).prisma.workflow.findMany({
        where: {
          projectId: input.projectId,
          OR: [{ isComponent: true }, { isEvaluator: true }],
        },
        include: { versions: true },
      });

      // Each component carries only the version it publishes; the studio picks
      // a component by its published shape, never by a draft.
      workflows.forEach((workflow) => {
        workflow.versions = workflow.versions.filter(
          (version) => version.id === workflow.publishedId,
        );
      });

      return workflows;
    },
  },
);
