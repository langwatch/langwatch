/**
 * Process wiring for the `user.*` tRPC surface.
 *
 * Most of it is package-owned now — `UserTrpcApi` in `@langwatch/user-server`,
 * mounted through `@langwatch/platform-api/app-trpc`. What is left here is the
 * composition this application still owns: its tRPC root, its public and
 * authenticated procedures, its authorization middlewares, and the adapters
 * behind every port the user package declares — the deployment's auth
 * provider, password hashing, the account rows, the Auth0 tenant, the
 * throttle, product analytics and the mailer.
 *
 * Three /me dashboard procedures are still assembled here rather than in the
 * package, and merged into the same `user` namespace below:
 * `personalUsage`, `budgetOverview` and `cliBootstrap`. Their answers ARE the
 * Enterprise governance contract's wire shapes, and a core feature package may
 * not import an Enterprise contract (`langwatch/package-boundaries`), so
 * moving them into `@langwatch/user-server` would mean restating that
 * contract. They belong to the governance feature that owns the data; this is
 * where they wait.
 *
 * Spec: packages/features/user/specs/user.feature,
 *       specs/settings/user-avatar.feature.
 */
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { createUserTrpcRouter, declaredCheckFrom } from "@langwatch/platform-api/app-trpc";
import type { Auth0PasswordChangeOutcome } from "@langwatch/user-server";
import { compare, hash } from "bcrypt";
import { z } from "zod";
import { env } from "~/env.mjs";
import { resolveAuthProvider } from "~/runtime/app/features/sso";
import type { TRPCContext } from "~/server/api/trpc.context";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { deploymentOffersPasskeys } from "~/server/app-layer/identity/signin-method-policy";
import { NoAdminConfiguredError } from "~/server/app-layer/organizations/errors";
import { Auth0ApiError, changeAuth0Password } from "~/server/auth0/passwordService";
import { sendBudgetIncreaseRequestEmail } from "~/server/mailer/budgetIncreaseRequestEmail";
import { resolveOrgAdminEmail } from "~/server/organizations/resolveOrgAdminEmail";
import { resolveSupportContact } from "~/server/organizations/resolveSupportContact";
import { trackServerEvent } from "~/server/posthog";
import { rateLimit } from "~/server/rateLimit";
import { getClientIp } from "~/utils/getClientIp";
import { createTRPCRouter, protectedProcedure } from "../trpc";
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

const logger = createLogger("langwatch:user-router");

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
 * The Auth0 Management API's refusals, as outcomes. The package turns each one
 * into the message the customer reads; anything that is not an Auth0 refusal
 * keeps travelling as itself and degrades to an unknown error with a trace id.
 */
function auth0Outcome(error: Auth0ApiError): Auth0PasswordChangeOutcome {
  switch (error.code) {
    case "weak_password":
      return { outcome: "weak_password", message: error.message };
    case "insufficient_scope":
      return { outcome: "insufficient_scope" };
    case "password_grant_not_enabled":
      return { outcome: "password_grant_not_enabled" };
    case "not_configured":
      return { outcome: "not_configured" };
    default:
      return { outcome: "failed" };
  }
}

const accountRouter = createUserTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  publicProcedure: appTrpcRoot.procedure,
  middlewares,
  ports: {
    resolveAuthProvider,
    deploymentOffersPasskeys,
    appBaseUrl: () => env.NEXTAUTH_URL ?? env.BASE_HOST ?? null,
    clientIp: (ctx: TRPCContext) => getClientIp(ctx.req) ?? "unknown",
    rateLimit,
    trackServerEvent,

    hashPassword: ({ password }) => hash(password, 10),
    passwordMatches: ({ password, hash: stored }) => compare(password, stored),
    tryFindCredentialAccount: (ctx: TRPCContext, { userId }) =>
      ctx.prisma.account.findFirst({
        where: { userId, provider: "credential" },
        select: { id: true, password: true },
      }),
    writeCredentialPassword: async (ctx: TRPCContext, { accountId, passwordHash }) => {
      await ctx.prisma.account.update({
        where: { id: accountId },
        data: { password: passwordHash },
      });
    },
    tryFindAuth0DatabaseAccount: (ctx: TRPCContext, { userId }) =>
      ctx.prisma.account.findFirst({
        where: {
          userId,
          provider: "auth0",
          providerAccountId: { startsWith: "auth0|" },
        },
        select: { providerAccountId: true },
      }),
    changeAuth0Password: async (input) => {
      try {
        const result = await changeAuth0Password(input);
        return result.ok ? { outcome: "changed" } : { outcome: "wrong_password" };
      } catch (error) {
        if (error instanceof Auth0ApiError) return auth0Outcome(error);
        throw error;
      }
    },

    emailIsTaken: async (ctx: TRPCContext, { email }) =>
      (await ctx.prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      })) !== null,
    listLinkedAccounts: (ctx: TRPCContext, { userId }) =>
      ctx.prisma.account.findMany({
        where: { userId },
        select: { id: true, provider: true, providerAccountId: true },
      }),
    // Serializable isolation prevents the read of the account count from being
    // a stale snapshot if a concurrent unlink commits between this
    // transaction's count and its delete.
    unlinkAccount: (ctx: TRPCContext, { userId, accountId }) =>
      ctx.prisma.$transaction(
        async (tx) => {
          const accountCount = await tx.account.count({ where: { userId } });
          if (accountCount <= 1) return "last_account" as const;
          const account = await tx.account.findFirst({
            where: { id: accountId, userId },
          });
          if (!account) return "not_found" as const;
          await tx.account.delete({ where: { id: accountId } });
          return "unlinked" as const;
        },
        { isolationLevel: "Serializable" },
      ),
    revokeCliTokensForUser: async (ctx: TRPCContext, input) => {
      await ctx.app.governance.cliTokenRevokeForUser(input);
    },

    isOrganizationMember: async (ctx: TRPCContext, { userId, organizationId }) =>
      (await ctx.prisma.organizationUser.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
      })) !== null,
    tryResolveSupportContact: (ctx: TRPCContext, { organizationId }) =>
      resolveSupportContact({ prisma: ctx.prisma, organizationId }),
    resolveBudgetIncreaseRecipient: async (ctx: TRPCContext, { organizationId }) => {
      const adminEmail = await resolveOrgAdminEmail({ prisma: ctx.prisma, organizationId });
      if (!adminEmail) {
        logger.warn(
          { organizationId },
          "budget increase requested but the organization has no admin",
        );
        throw new NoAdminConfiguredError();
      }
      return adminEmail;
    },
    sendBudgetIncreaseRequest: (ctx: TRPCContext, input) =>
      sendBudgetIncreaseRequestEmail({ mailer: ctx.app.mailer, ...input }),
    tryGetOrganizationName: async (ctx: TRPCContext, { organizationId }) =>
      (
        await ctx.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        })
      )?.name ?? null,
    tryGetUserContact: (ctx: TRPCContext, { userId }) =>
      ctx.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      }),
    tryFindFirstProjectSlug: async (ctx: TRPCContext, { organizationId, userId }) =>
      (
        await ctx.prisma.project.findFirst({
          where: {
            team: { organizationId, members: { some: { userId } } },
            archivedAt: null,
          },
          orderBy: { createdAt: "asc" },
          select: { slug: true },
        })
      )?.slug ?? null,

    tryResolveDefaultRoutingPolicy: (ctx: TRPCContext, input) =>
      ctx.app.governance.tryResolveDefaultRoutingPolicyForUser(input),
    listPersonalVirtualKeys: (ctx: TRPCContext, input) =>
      ctx.app.governance.personalVirtualKeyList(input),
    checkBudget: (ctx: TRPCContext, input) => ctx.app.gatewayStores.budgetDecisions.check(input),
  },
});

/**
 * The /me dashboard reads whose answers are the governance and gateway
 * services' own wire shapes. See the note at the top of this file: they are
 * assembled here only because a core feature package cannot name an Enterprise
 * contract, and they are merged into the one `user` namespace below so the
 * procedure names the client calls are unchanged.
 */
const dashboardRouter = createTRPCRouter({
  /**
   * Per-user usage rollup powering the /me dashboard cards, charts and recent
   * activity. Scoped to the user's personal project (which by definition has
   * only their traces — no cross-user contamination possible).
   *
   * Returns empty-state safe values (zeros, empty arrays, null model) when no
   * traces exist yet, so the page can render before the user's first CLI
   * request lands.
   */
  personalUsage: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        /** Defaults to start-of-current-month → now if omitted. */
        windowStartMs: z.number().optional(),
        windowEndMs: z.number().optional(),
      }),
    )
    .permission("organization:view")
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertOrganizationMember({ ctx, userId, organizationId: input.organizationId });

      // Find the user's personal project. If none yet, return empty-state.
      const workspace = await ctx.app.users.tryFindPersonalWorkspace({
        userId,
        organizationId: input.organizationId,
      });
      if (!workspace) {
        return {
          summary: {
            spentUsd: 0,
            billedUsd: 0,
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            mostUsedModel: null,
          },
          dailyBuckets: [],
          breakdownByModel: [],
        };
      }

      const window =
        input.windowStartMs && input.windowEndMs
          ? { startMs: input.windowStartMs, endMs: input.windowEndMs }
          : undefined;

      const usage = ctx.app.governance;

      // Ingestion-source ledger rows (Claude Code OTLP, and the rest) land
      // under the organization's hidden Governance Project tenant. Resolve it
      // read-only so the PRINCIPAL-ledger union is scoped to this
      // organization's tenant.
      const governanceProject = await ctx.app.projects.projectService.tryFindInternal({
        organizationId: input.organizationId,
        kind: "internal_governance",
      });

      // Run the rollup queries in parallel — they're independent and the
      // analytics server happily multiplexes. `userId` and
      // `ingestionTenantId` are threaded so the usage service can union
      // ingestion-source ledger rows keyed on PRINCIPAL-scope budgets where
      // the scope id is the user id, scoped to this organization's governance
      // tenant. Without them, the /me dashboard misses third-party traffic
      // landing in the hidden governance project tenant. Recent activity
      // itself is read directly from the personal project tenant by the /me
      // table, so it isn't fetched here.
      const ingestionTenantId = governanceProject?.id;
      const [summary, dailyBuckets, breakdownByModel] = await Promise.all([
        usage.personalUsageSummary({
          personalProjectId: workspace.project.id,
          window,
          userId,
          ingestionTenantId,
        }),
        usage.personalUsageDailyBuckets({
          personalProjectId: workspace.project.id,
          window,
          userId,
          ingestionTenantId,
        }),
        usage.personalUsageBreakdownByModel({
          personalProjectId: workspace.project.id,
          window,
          userId,
          ingestionTenantId,
        }),
      ]);

      return { summary, dailyBuckets, breakdownByModel };
    }),

  /**
   * Every budget that binds the caller's own keys in this organization, each
   * labelled with its scope ("whole organization budget", "team budget
   * (Core)", "personal budget"), most binding first. One source: the same
   * overview the CLI's budget-overview endpoint serves, so /me and the login
   * epilogue can never report different numbers for the same budget.
   *
   * A caller with no gateway access gets an answer whose consumer renders
   * nothing budget-related.
   *
   * Authorization: members read their OWN overview only — the user id is
   * always the session's. `organization:view` is the entry gate; the service
   * re-checks membership itself, fail closed.
   */
  budgetOverview: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        includeTopModels: z.boolean().optional(),
      }),
    )
    .permission("organization:view")
    .query(async ({ ctx, input }) =>
      ctx.app.governance.personalBudgetOverviewForUser({
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        includeTopModels: input.includeTopModels,
      }),
    ),

  /**
   * CLI bootstrap data for the login-completion ceremony: inherited providers
   * (with display name and model list) plus the monthly budget (limit and
   * used).
   *
   * Empty-state safe: answers no providers and an unset monthly budget when
   * the user has no personal workspace yet.
   */
  cliBootstrap: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ ctx, input }) =>
      ctx.app.governance.cliBootstrapResolve({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      }),
    ),
});

/**
 * Membership, checked again after `organization:view`. The permission answers
 * "may this caller act on an organization at all"; this answers "is this one
 * theirs", which is what keeps a personal rollup inside the caller's own
 * tenant.
 */
async function assertOrganizationMember({
  ctx,
  userId,
  organizationId,
}: {
  ctx: TRPCContext;
  userId: string;
  organizationId: string;
}): Promise<void> {
  const membership = await ctx.prisma.organizationUser.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  if (membership) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `Not a member of organization ${organizationId}`,
  });
}

export const userRouter = appTrpcRoot.mergeRouters(accountRouter, dashboardRouter);
