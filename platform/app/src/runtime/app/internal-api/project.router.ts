import {
  authzDeclarationOf,
  declareAuthzMiddleware,
  type AuthzPermission,
} from "@langwatch/authz-contract";
import { ProjectTrpcApi } from "@langwatch/project-server";
import { TRPCError } from "@trpc/server";
import { auditLog } from "~/runtime/app/features/audit-log";
import { provisionLangyVirtualKey } from "~/runtime/app/features/langy-virtual-key.adapter";
import {
  checkOrganizationPermission,
  checkTeamPermission,
  type PermissionMiddlewareParams,
} from "~/server/api/rbac";
import type { TRPCContext } from "~/server/api/trpc.context";
import { appTrpcRoot } from "~/server/api/trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "~/server/api/trpc.runtime-policy";
import { scopeLineageGuard } from "~/server/api/trpc.scope-lineage-middleware";
import { getUserProtectionsForProject } from "~/server/api/utils";
import { checkDeclaredPermission } from "~/server/app-layer/authz/trpc-middleware";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { encrypt } from "~/utils/encryption";
import { captureException, toError } from "~/utils/posthogErrorCapture";

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that applies process middlewares to a builder whose input generics
 * belong to the feature package, so the policies below need no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/** Either declared check the chain below installs, as its factory builds it. */
type DeclaredCheck = ReturnType<typeof checkDeclaredPermission> | typeof createProjectAccess;

/**
 * Exactly the chain `protectedProcedure.input(…).permission(…)` — or
 * `.use(declareAuthzMiddleware(…))` — builds, handed to the feature so it
 * applies the policy AFTER its own input parser: tRPC runs middlewares in the
 * order they were added, and the declared check reads its scope id from the
 * validated input. The check carries the authz declaration the router sweep
 * reads, so these procedures stay declared.
 */
const policyFor =
  (check: DeclaredCheck) =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as unknown as ChainableProcedure)
      .use(tracerMiddleware)
      .use(loggerMiddleware)
      .use(handledErrorMiddleware)
      // Ahead of the check on purpose: a request mixing scope ids across
      // organizations is refused before the declaration can pass on one id
      // while the handler acts on another.
      .use(scopeLineageGuard(authzDeclarationOf(check)))
      .use(check)
      .use(enforcePermissionCheck)
      .use(auditLogMutations) as unknown as TProcedure;

/**
 * `project.create` names two tiers and acts on exactly one of them, decided by
 * what was asked for. Neither `.permission()` form could express that, so the
 * check is declared custom and the sweep reads both permissions off it.
 */
const createProjectAccess = declareAuthzMiddleware(
  {
    kind: "custom",
    reason:
      "creating into an existing team asks that team; creating a team alongside asks the organization",
    permissions: ["project:create", "organization:manage"],
  },
  ({
    ctx,
    input,
    next,
  }: PermissionMiddlewareParams<{
    organizationId: string;
    teamId?: string;
    newTeamName?: string;
  }>) => {
    if (input.teamId) {
      return checkTeamPermission("project:create")({
        ctx,
        input: { ...input, teamId: input.teamId },
        next,
      });
    } else if (input.newTeamName) {
      return checkOrganizationPermission("organization:manage")({
        ctx,
        input,
        next,
      });
    } else {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Either teamId or newTeamName must be provided",
      });
    }
  },
);

/**
 * Flipping trace sharing changes who OUTSIDE the project can read its traces,
 * so it takes `project:manage` on top of the `project:update` the rest of the
 * settings form runs at. Not an authz declaration: it sits after the declared
 * check, exactly where the router chained it before.
 */
async function checkCapturedDataVisibilityPermission({
  ctx,
  input,
  next,
}: {
  ctx: TRPCContext;
  input: {
    projectId: string;
    traceSharingEnabled?: boolean;
  };
  next: () => Promise<any>;
}) {
  if (
    input.traceSharingEnabled !== void 0 &&
    !(await probeProjectPermission(ctx, input.projectId, "project:manage"))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to change trace sharing settings",
    });
  }
  return next();
}

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const projectRouter = ProjectTrpcApi.create(
  appTrpcRoot,
  {
    protected: authProtectedProcedure,
    policy: (permission: AuthzPermission) => policyFor(checkDeclaredPermission({ permission })),
    createPolicy: policyFor(createProjectAccess),
    updatePolicy: <TProcedure>(procedure: TProcedure): TProcedure =>
      (
        policyFor(checkDeclaredPermission({ permission: "project:update" }))(
          procedure,
        ) as unknown as ChainableProcedure
      ).use(checkCapturedDataVisibilityPermission) as unknown as TProcedure,
  },
  {
    encryptProjectSecret: encrypt,
    probeProjectPermission: (ctx: TRPCContext, projectId, permission) =>
      probeProjectPermission(ctx, projectId, permission),
    getFieldProtections: (ctx: TRPCContext, input) => getUserProtectionsForProject(ctx, input),
    // Best-effort: mint Langy's gateway virtual key so it shows up in the
    // user's /virtual-keys list from day 1 (configurable model + fallback
    // chain + spend tracking like any other VK). Failure here doesn't block
    // project creation; the credential service re-attempts on first /chat
    // call.
    provisionLangyVirtualKey: async (
      ctx: TRPCContext,
      { projectId, organizationId, actorUserId },
    ) => {
      try {
        await provisionLangyVirtualKey({
          prisma: ctx.prisma,
          virtualKeys: ctx.app.gateway.virtualKeys,
          projectId,
          organizationId,
          actorUserId,
        });
      } catch (error) {
        captureException(toError(error), {
          extra: {
            projectId,
            context: "provisionLangyVirtualKey:project.create",
          },
        });
      }
    },
    recordApiKeyRegenerated: ({ userId, projectId }) =>
      auditLog({
        action: "project.apiKey.regenerated",
        userId,
        projectId,
      }).catch(captureException),
    reportTopicClusteringFailure: (error, { projectId }) => {
      captureException(toError(error), { extra: { projectId } });
    },
  },
);
