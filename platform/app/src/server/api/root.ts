import { governanceRouter } from "./routers/governance/governance";
import { createTRPCRouter } from "~/server/api/trpc";
import {
  createGatewayTrpcRouters,
  declaredCheckFrom,
  type GatewayTrpcPorts,
} from "@langwatch/platform-api/app-trpc";
import {
  appTrpcNoPermissionPolicy,
  appTrpcPolicy,
  appTrpcServiceAuthorizedPolicy,
  type AppTrpcPolicyMiddlewares,
} from "@langwatch/api/trpc";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import {
  fireIntegrationMethodNurturing,
  mapProductSelectionToIntegrationMethod,
} from "~/server/app-layer/billing/nurturing/productInterest";
import { afterPromptCreated } from "~/server/app-layer/billing/nurturing/promptCreation";
import { fireSignupNurturingCalls } from "~/server/app-layer/billing/nurturing/signupIdentification";
import { prisma } from "~/server/db";
import { captureException } from "~/utils/posthogErrorCapture";
import { appTrpcRoot } from "./trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "./trpc.runtime-policy";
import { scopeLineageGuard } from "./trpc.scope-lineage-middleware";
import {
  BACK_OFFICE_NO_PERMISSION,
  BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION,
  CURRENCY_NO_PERMISSION,
  EnterpriseGatewayTrpcComposition,
  EnterpriseGovernanceTrpcComposition,
  EnterpriseTrpcComposition,
  INSTANCE_LICENSE_NO_PERMISSION,
} from "@langwatch/enterprise-api";
import {
  InvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError,
  type DataPrivacyConfig,
  type DataPrivacyScope,
} from "@langwatch/data-privacy-contract";
import { z } from "zod";
import type { TRPCContext } from "./trpc.context";
import { getUserProtectionsForProject } from "./utils";
import { virtualKeyBudgetInputSchema } from "~/server/gateway/virtualKey.service";
import { env } from "~/env.mjs";
import { auditLog } from "~/runtime/app/features/audit-log";
import {
  identityEmail,
  joinRequestsService,
  signInRouter,
  signUpVerification,
  ssoConnections,
  verificationCeremony,
} from "~/server/app-layer/identity/runtime";
import { SsoConnectionBackofficeService } from "~/server/app-layer/identity/sso-connection-backoffice.service";
import {
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
} from "@langwatch/enterprise-plan-gate";
// `isCustomRole` is a role-NAMING convention, not an entitlement, which is why
// it stays behind when the plan gate leaves.
import { isCustomRole } from "./enterprise";
import {
  authorizeInResolver,
  batchScopePermissions,
  checkOrganizationPermission,
  checkProjectPermission,
  type PermissionMiddlewareParams,
} from "./rbac";
import { declareAuthzMiddleware, type AuthzPermission } from "@langwatch/authz-contract";
import {
  RoleBindingScopeType,
  type DataPrivacyPolicy as DataPrivacyPolicyRow,
  type PrismaClient,
} from "~/generated/prisma/client";
import { deploymentOffersPasskeys } from "~/server/app-layer/identity/signin-method-policy";
import { buildInviteAcceptUrl, buildMembersSettingsUrl } from "~/server/invites/invite-link";
import {
  InviteExpiredError,
  InviteNotFoundError,
} from "~/server/invites/errors";
import {
  resolveInviteDisplayStatus,
} from "~/server/invites/invite.service";
import { toError } from "~/utils/posthogErrorCapture";
import { timeseriesInput } from "~/server/analytics/registry";
import { sharedFiltersInputSchema } from "~/server/analytics/types";
import { MAX_LWQL_LENGTH } from "~/server/analytics/lwql";
import { lwqlEnabled } from "~/server/analytics/lwql/access";
import {
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "~/server/analytics/lwql/timeWindowSchema";
import {
  AppSavedWorkbenchChartPolicy,
  mapDashboardSavedWorkbenchChartError,
} from "~/runtime/app/features/dashboard-saved-workbench-chart-policy.adapter";
import { availableFilters } from "~/server/filters/registry";
import { resolveLangWatchQLCaller } from "./ports/lwqlCaller";
import { enforceWorkbenchEnabled } from "./ports/workbenchAccessMiddleware";
import { Auth0ApiError, changeAuth0Password } from "~/server/auth0/passwordService";
import {
  getDataPrivacyPolicyService,
  InvalidDataPrivacyConfigError as AppInvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError as AppScopeTargetNotFoundError,
} from "~/server/data-privacy/dataPrivacyPolicy.service";
import { sendBudgetIncreaseRequestEmail } from "~/server/mailer/budgetIncreaseRequestEmail";
import { rateLimit } from "~/server/rateLimit";
import { getClientIp } from "~/utils/getClientIp";
import { githubRouter } from "~/runtime/app/internal-api/github.router";
import { secretsRouter } from "~/runtime/app/internal-api/secrets.router";
import type { resolveAnnotationSuggestionTarget } from "@langwatch/annotation-contract";
import {
  createOrUpdateQueueItems,
  PostgresAnnotationQueueAdapter,
} from "@langwatch/annotation-server";
import { AuthApp } from "@langwatch/auth-server";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { pMapLimited } from "@langwatch/eventing";
import { featureByKey } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { WorkflowVersionRequiredError, type StudioWorkflow } from "@langwatch/workflow-contract";
import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { compare, hash } from "bcrypt";
import { createPatch } from "diff";
import { nanoid } from "nanoid";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { resolveAuthProvider } from "~/runtime/app/features/sso";
import { getAzureSafetyEnvFromProject } from "~/server/app-layer/evaluations/azure-safety-env.server";
import { evaluatorUnavailability } from "~/server/evaluations/installedEvaluators";
import { runEvaluationForTrace } from "~/server/evaluations/runEvaluation";
import { workbenchStateSchema } from "~/server/experiments-v3/legacy-workbench.schema";
import { filterFieldsEnum } from "~/server/filters/types";
import { coerceMonitorMappings, mappingStateSchema } from "~/server/tracer/tracesMapping";
import { slugify } from "~/utils/slugify";

/**
 * The `user.*` surface's own logger, kept under the name its lines have always
 * carried: a rename here would break every saved query that reads them.
 */
const userLogger = createLogger("langwatch:user-router");

/**
 * The Auth0 Management API's refusals, as outcomes. The user package turns each
 * one into the message the customer reads; anything that is not an Auth0
 * refusal keeps travelling as itself and degrades to an unknown error with a
 * trace id.
 *
 * The outcomes are `as const` rather than annotated with the package's own
 * union: naming that type here would mean importing a feature SERVER package
 * into the router root for a type alone, and the literal types the assertion
 * preserves are what the port checks its answer against anyway.
 */
function auth0Outcome(error: Auth0ApiError) {
  switch (error.code) {
    case "weak_password":
      return { outcome: "weak_password", message: error.message } as const;
    case "insufficient_scope":
      return { outcome: "insufficient_scope" } as const;
    case "password_grant_not_enabled":
      return { outcome: "password_grant_not_enabled" } as const;
    case "not_configured":
      return { outcome: "not_configured" } as const;
    default:
      return { outcome: "failed" } as const;
  }
}

/** This process's concrete policy chain, in the order the mounts apply it. */
const appTrpcMiddlewares: AppTrpcPolicyMiddlewares = {
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

/** What every package-owned mount needs from this process. */
const appTrpcMount = {
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares: appTrpcMiddlewares,
};

/**
 * The setup rollup behind `integrationsChecks.getCheckStatus`.
 *
 * It stays here rather than in the project package because of what it reads:
 * nine other verticals' storage — workflows, custom graphs, datasets, online
 * evaluations, triggers, team members, model providers, simulations and
 * prompts — beside the project's own two columns. That fan-out is the
 * application's, exactly as the recent-items reader above it is.
 */

const noPermissionPolicy = appTrpcNoPermissionPolicy(appTrpcMiddlewares);

const enterpriseRouters = EnterpriseTrpcComposition.create({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  policy: appTrpcPolicy(appTrpcMiddlewares),
  instanceLicensePolicy: noPermissionPolicy(INSTANCE_LICENSE_NO_PERMISSION),
  currencyPolicy: noPermissionPolicy(CURRENCY_NO_PERMISSION),
  backOfficePolicy: noPermissionPolicy(BACK_OFFICE_NO_PERMISSION),
  backOfficePolicyForOrganization: noPermissionPolicy(BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION),
  saasBilling: env.IS_SAAS,
  ports: {
    scimToken: {
      requireEnterprisePlan: async ({ planProvider, organizationId }) => {
        const plan = await planProvider.getActivePlan({ organizationId });
        assertEnterprisePlanType({
          planType: plan.type,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
        });
      },
    },
    ssoConnections: {
      backoffice: () => new SsoConnectionBackofficeService({ prisma, connections: ssoConnections }),
      recordAudit: auditLog,
    },
  },
});

/**
 * All that is left of the seam between the gateway transports and this
 * application.
 *
 * Everything else this bag carried — the visibility rules, the per-scope
 * checks, the DTO projections, the budget resolvers, the usage reads — now
 * lives on `GatewayApp`, which the routers reach at `ctx.app.gateway` and the
 * process composes once in `app-layer/presets.ts`. That composition is also
 * what the public REST family is given, so the two doors cannot enforce
 * different rules.
 *
 * The budget parser cannot follow it there. A tRPC procedure's input parser is
 * fixed when the router is BUILT and the application is a per-request value,
 * so this one member stays an argument.
 */
const gatewayTrpcPorts = {
  virtualKeys: { virtualKeyBudgetInput: virtualKeyBudgetInputSchema },
  // `satisfies`, not an annotation: an annotation would collapse the parser's
  // concrete type to the loose constraint and the router would lose the shape
  // its create and update inputs publish.
} satisfies GatewayTrpcPorts;

const gatewayRouters = createGatewayTrpcRouters({ ...appTrpcMount, ports: gatewayTrpcPorts });

const enterpriseGatewayRouters = EnterpriseGatewayTrpcComposition.create({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  policy: appTrpcPolicy(appTrpcMiddlewares),
  resolverAuthorizedPolicy: appTrpcServiceAuthorizedPolicy(appTrpcMiddlewares),
});

const enterpriseGovernanceRouters = EnterpriseGovernanceTrpcComposition.create({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  policy: appTrpcPolicy(appTrpcMiddlewares),
});

/** The sign-up ceremony, composed per request over this process's app. */
const signUp = (ctx: TRPCContext) => signUpVerification(ctx.app.mailer, ctx.app.users.userService);

/**
 * The auth feature's application, composed once over this process.
 *
 * Both signed-out doors take it — the front door and `publicEnv` beside it —
 * which is why it is built in one place rather than composed twice. Every
 * capability it holds is the process's, and each takes the request rather than
 * being captured from one, so a single instance serves every caller.
 */
const authApp = AuthApp.create({
  clientIp: (ctx: TRPCContext) => getClientIp(ctx.req) ?? "unknown",
  rateLimit,
  route: (input) => signInRouter().route(input),
  addressIsRegistered: (ctx: TRPCContext, input) => signUp(ctx).addressIsRegistered(input),
  requestSignUpVerification: (ctx: TRPCContext, input) => signUp(ctx).requestVerification(input),
  completeSignUpVerification: (ctx: TRPCContext, input) => signUp(ctx).completeVerification(input),

  /**
   * A revoked invitation reads exactly like a missing one, the same way
   * `organization.acceptInvite` answers it: the journey ends quietly,
   * revealing nothing about the organization or the inviter. Expired is
   * different — it is recoverable (the inviter resends in one click), so it
   * gets its own named refusal.
   */
  readInviteLanding: async (ctx: TRPCContext, { inviteCode }) => {
    const invite = await ctx.prisma.organizationInvite.findUnique({
      where: { inviteCode },
      select: {
        status: true,
        expiration: true,
        organization: { select: { name: true } },
        requestedByUser: { select: { name: true } },
      },
    });

    if (!invite || invite.status === "REVOKED") {
      throw new InviteNotFoundError("Invitation not found");
    }

    const status = resolveInviteDisplayStatus(invite);
    if (status === "EXPIRED") {
      throw new InviteExpiredError();
    }

    return {
      organizationName: invite.organization.name,
      inviterName: invite.requestedByUser?.name ?? null,
      alreadyAccepted: status === "ACCEPTED",
    };
  },

  requestFreshInvite: async (ctx: TRPCContext, { inviteCode }) => {
    await invitesFor(ctx).requestFreshInvite({
      inviteCode,
      membersSettingsUrl: buildMembersSettingsUrl(),
    });
  },

  // ADR-027: the single source of truth for the sign-in mode. Never read
  // `env.NEXTAUTH_PROVIDER` directly here — a deployment whose licence gate
  // denies SSO must still be told to render the email form.
  resolveAuthProvider,
});

/** The join-request service, composed per request over this process's app. */
function joinRequestsFor(ctx: Pick<TRPCContext, "app">) {
  return joinRequestsService({
    authzGrants: ctx.app.authzGrants,
    featureFlags: ctx.app.featureFlags,
    mailer: ctx.app.mailer,
  });
}

/**
 * The caller's own verified address, and the reason every requester-side
 * join-request procedure starts here.
 *
 * `tryVerifiedEmailsOf` answers `null` for a user who is not on identifiers yet,
 * which is the legacy fallback the rest of the identity surface uses: the
 * `User.email` column, but only where better-auth has marked it verified. An
 * unverified address answers null, and every caller treats that as the
 * universal nothing.
 */
async function verifiedEmailFor(
  ctx: Pick<TRPCContext, "prisma">,
  { userId }: { userId: string },
): Promise<string | null> {
  const verified = await identityEmail().tryVerifiedEmailsOf({ userId });
  if (verified !== null) return verified[0]?.value ?? null;

  const row = await ctx.prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  return row?.emailVerified ? (row.email ?? null) : null;
}

/** The feature transports are typed against their own context; this is ours. */
const appContext = (ctx: unknown) => ctx as TRPCContext;

/**
 * Copies a workflow into another project, answering the code the experiment
 * surface has always answered when the source has no version to copy.
 *
 * The refusal is the feature's — a workflow with no committed version cannot
 * be replicated — and translating it into a transport code is the process's,
 * because the experiment transport maps workflow errors no further.
 */
async function copyStudioWorkflow(
  ctx: TRPCContext,
  input: Parameters<TRPCContext["app"]["workflows"]["copyStudioWorkflow"]>[0],
): Promise<{ workflowId: string; dsl: StudioWorkflow }> {
  try {
    return await ctx.app.workflows.copyStudioWorkflow(input);
  } catch (error) {
    if (error instanceof WorkflowVersionRequiredError) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Workflow version not found" });
    }
    throw error;
  }
}

/** Where one copy lives, for the "org / team / project" path shown beside it. */
const workflowCopyPathSelect = {
  id: true,
  name: true,
  projectId: true,
  project: {
    select: {
      id: true,
      name: true,
      team: {
        select: {
          id: true,
          name: true,
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
} as const;

/** The copy-lineage selection `workflow.getAll` redacts against permissions. */
const workflowCopyLineageSelect = {
  id: true,
  projectId: true,
  name: true,
  icon: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  latestVersionId: true,
  currentVersionId: true,
  publishedId: true,
  publishedById: true,
  archivedAt: true,
  isEvaluator: true,
  isComponent: true,
  copiedFromWorkflowId: true,
  copiedFrom: {
    select: workflowCopyPathSelect,
  },
  copiedWorkflows: {
    where: { archivedAt: null },
    select: { projectId: true },
  },
} as const;

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that chains the workbench rollout gate onto a builder whose input
 * generics belong to the feature package, so the gate below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/**
 * The workbench rollout gate, applied AFTER the policy so a caller is placed by
 * RBAC first and gated by the experiment second: a member who may not touch the
 * project must not learn from the answer whether the experiment is on for it.
 */
const requireWorkbenchEnabled = <TProcedure>(procedure: TProcedure): TProcedure =>
  (procedure as unknown as ChainableProcedure).use(
    enforceWorkbenchEnabled,
  ) as unknown as TProcedure;

/**
 * The one resolution both LangWatchQL doors run their statements as. It hashes
 * the project's LangWatchQL secret into the tenant capability the query runs
 * as, so it stays here and never leaves the calling procedure.
 */
const resolveRunCaller = (ctx: TRPCContext, input: { projectId: string }) =>
  resolveLangWatchQLCaller({ ctx, projectId: input.projectId });

/** The member's own content protections for one project. */
const resolveWorkbenchProtections = (ctx: TRPCContext, input: { projectId: string }) =>
  getUserProtectionsForProject(ctx, { projectId: input.projectId });

/** The same rollout decision, read rather than enforced. */
const isWorkbenchEnabled = (ctx: TRPCContext, input: { projectId: string }) =>
  lwqlEnabled({
    featureFlags: ctx.app.featureFlags,
    projectId: input.projectId,
    projects: ctx.app.projects.projectService,
  });

const coreRouters = {
  secrets: secretsRouter,
  virtualKeys: gatewayRouters.virtualKeys,
  personalVirtualKeys: enterpriseGatewayRouters.personalVirtualKeys,
  routingPolicy: enterpriseGatewayRouters.routingPolicy,
  ingestionSources: enterpriseGovernanceRouters.ingestionSources,
  activityMonitor: enterpriseGovernanceRouters.activityMonitor,
  anomalyRules: enterpriseGovernanceRouters.anomalyRules,
  aiTools: enterpriseGovernanceRouters.aiTools,
  departments: enterpriseGovernanceRouters.departments,
  ingestionTemplates: enterpriseGovernanceRouters.ingestionTemplates,
  ingestionKey: enterpriseGovernanceRouters.ingestionKey,
  governance: appTrpcRoot.mergeRouters(governanceRouter, enterpriseGovernanceRouters.governance),
  personalSessions: enterpriseGovernanceRouters.personalSessions,
  sessionPolicy: enterpriseGovernanceRouters.sessionPolicy,
  gatewayBudgets: gatewayRouters.gatewayBudgets,
  gatewayCacheRules: gatewayRouters.gatewayCacheRules,
  gatewayGuardrails: gatewayRouters.gatewayGuardrails,
  gatewayUsage: gatewayRouters.gatewayUsage,
  gatewaySpendEvents: gatewayRouters.gatewaySpendEvents,
  webhookEndpoints: enterpriseGatewayRouters.webhookEndpoints,
  github: githubRouter,
};

const eeRouters = {
  subscription: enterpriseRouters.subscription,
  currency: enterpriseRouters.currency,
};

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  ...coreRouters,
  ...eeRouters,
});

// export type definition of API
export type AppRouter = typeof appRouter;
