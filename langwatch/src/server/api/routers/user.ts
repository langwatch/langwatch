import { TRPCError } from "@trpc/server";
import { compare, hash } from "bcrypt";
import { z } from "zod";
import { env } from "../../../env.mjs";

import { checkOrganizationPermission, skipPermissionCheck } from "../rbac";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { UserService } from "~/server/users/user.service";
import { revokeOtherSessionsForUser } from "~/server/better-auth/revokeSessions";
import { rateLimit } from "~/server/rateLimit";
import { getClientIp } from "~/utils/getClientIp";
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import { PersonalWorkspaceService } from "~/server/governance/personalWorkspace.service";
import { PersonalVirtualKeyService } from "~/server/governance/personalVirtualKey.service";
import { RoutingPolicyService } from "~/server/governance/routingPolicy.service";
import { PersonalUsageService } from "~/server/governance/personalUsage.service";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { CliBootstrapService } from "~/server/governance/cliBootstrap.service";

export const userRouter = createTRPCRouter({
  /**
   * Whether the current user is a platform admin (email listed in ADMIN_EMAILS).
   * Exposed so the client can decide whether to render admin-only UI surfaces
   * like the OPS Backoffice sidebar entry. This is NOT an authorization gate —
   * server-side admin routes enforce access independently via isAdmin.
   */
  isAdmin: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .query(({ ctx }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      return { isAdmin: checkIsAdmin({ email: user.email }) };
    }),
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, "Name is required"),
        email: z.string().email("Invalid email"),
        // Match the strength requirement enforced by `changePassword`
        // (min 8) and the signup form's client-side check (was min 6 —
        // updated to align). Without this, the server accepted any
        // password (even a single character) while the form rejected
        // anything under 6, leading to a server/client validation gap.
        password: z
          .string()
          .min(8, "Password must be at least 8 characters"),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      const { name, email, password } = input;

      if (env.NEXTAUTH_PROVIDER !== "email") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Direct registration is not available for this auth provider",
        });
      }

      // Per-IP rate limit. Mirrors BetterAuth's `/sign-up/email` 20-per-hour
      // limit so the tRPC path can't be used as a side-channel for spam
      // signups (iter 45/46 of the migration audit).
      const ip = getClientIp(ctx.req) ?? "unknown";
      const limit = await rateLimit({
        key: `user.register:${ip}`,
        windowSeconds: 60 * 60,
        max: 20,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many signup attempts. Please try again later.",
        });
      }

      const user = await ctx.prisma.user.findUnique({
        where: {
          email,
        },
      });

      if (user) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User already exists",
        });
      }

      const hashedPassword = await hash(password, 10);

      const newUser = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name,
            email,
          },
        });
        await tx.account.create({
          data: {
            userId: created.id,
            type: "credential",
            provider: "credential",
            providerAccountId: created.id,
            password: hashedPassword,
          },
        });
        return created;
      });

      return { id: newUser.id };
    }),
  updateLastLogin: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .mutation(async ({ ctx }) => {
      // Don't update lastLoginAt for impersonated sessions — an admin
      // browsing as another user should not overwrite that user's
      // last-login timestamp with the admin's activity.
      if (ctx.session.user.impersonator) return;

      await ctx.prisma.user.update({
        where: {
          id: ctx.session.user.id,
        },
        data: {
          lastLoginAt: new Date(),
        },
      });
    }),
  getSsoStatus: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .query(async ({ ctx }) => {
      return UserService.create(ctx.prisma).getSsoStatus({ id: ctx.session.user.id });
    }),
  getLinkedAccounts: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .query(async ({ ctx }) => {
      const accounts = await ctx.prisma.account.findMany({
        where: {
          userId: ctx.session.user.id,
        },
        select: {
          id: true,
          provider: true,
          providerAccountId: true,
        },
      });

      return accounts;
    }),
  unlinkAccount: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      // Wrap the count + delete in a serializable transaction. The
      // previous implementation did the count and delete as separate
      // statements with no isolation, so two concurrent unlink calls
      // (e.g. user double-clicking the X) could both observe
      // `count = 2`, both pass the "last account" guard, and both
      // delete — leaving the user with zero accounts and no way to
      // sign in. Iter 49 / bug 37 of the BetterAuth migration audit.
      const userId = ctx.session.user.id;
      await ctx.prisma.$transaction(
        async (tx) => {
          const accountCount = await tx.account.count({
            where: { userId },
          });
          if (accountCount <= 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot remove the last authentication method",
            });
          }
          const account = await tx.account.findFirst({
            where: { id: input.accountId, userId },
          });
          if (!account) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Account not found",
            });
          }
          await tx.account.delete({ where: { id: input.accountId } });
        },
        // Serializable isolation prevents the read of `accountCount`
        // from being a stale snapshot if a concurrent unlink commits
        // between this transaction's count and delete.
        { isolationLevel: "Serializable" },
      );

      return { success: true };
    }),
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z
          .string()
          .min(8, "Password must be at least 8 characters"),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      if (env.NEXTAUTH_PROVIDER !== "email") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Password changes are not available for this auth provider",
        });
      }

      // Per-user rate limit. BetterAuth's `/change-password` endpoint
      // is gated by `sensitiveSessionMiddleware` which forces recent
      // re-authentication; this tRPC mutation does NOT, so without a
      // throttle a stolen session token could be used to brute-force
      // the `currentPassword` to recover the user's plaintext (bcrypt
      // is slow but not infinite). 5 attempts per 15 minutes per user
      // mirrors `/forget-password`'s budget. Iter 49 of the migration
      // audit (bug 36).
      const limit = await rateLimit({
        key: `user.changePassword:${ctx.session.user.id}`,
        windowSeconds: 60 * 15,
        max: 5,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many password change attempts. Please try again later.",
        });
      }

      const credentialAccount = await ctx.prisma.account.findFirst({
        where: {
          userId: ctx.session.user.id,
          provider: "credential",
        },
        select: { id: true, password: true },
      });

      if (!credentialAccount?.password) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found or password not set",
        });
      }

      const passwordMatch = await compare(
        input.currentPassword,
        credentialAccount.password,
      );
      if (!passwordMatch) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        });
      }

      const hashedPassword = await hash(input.newPassword, 10);

      await ctx.prisma.account.update({
        where: { id: credentialAccount.id },
        data: { password: hashedPassword },
      });

      // Best practice: invalidate all OTHER sessions of this user after a
      // password change. The current tab stays logged in (the user just
      // re-authenticated by typing the current password); any other
      // device or stolen session is force-logged-out. Skip during
      // impersonation — the impersonator is the admin, and the
      // ctx.session.sessionId is the admin's session, so revoking
      // "other" sessions for the impersonated user wouldn't keep the
      // admin's tab open. In an impersonation context, password change
      // shouldn't be exposed in the UI, but be defensive.
      if (!ctx.session.user.impersonator && ctx.session.sessionId) {
        await revokeOtherSessionsForUser({
          prisma: ctx.prisma,
          userId: ctx.session.user.id,
          keepSessionId: ctx.session.sessionId,
        });
      }

      return { success: true };
    }),
  deactivate: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      // UserService.deactivate also force-revokes all the user's sessions
      // (Redis cache + DB) — see iter-24 progress notes for why.
      await UserService.create(ctx.prisma).deactivate({ id: input.userId });
      return { success: true };
    }),
  reactivate: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      await UserService.create(ctx.prisma).reactivate({ id: input.userId });
      return { success: true };
    }),

  /**
   * Personal context for a user inside an organization. Backs the /me
   * dashboard's `usePersonalContext` hook (see
   * src/components/me/usePersonalContext.ts for the consumed shape).
   *
   * Lazily provisions the personal workspace on first call so existing
   * users (who joined the org before this feature shipped) get one
   * without re-accepting an invite.
   *
   * Cost / activity rollups are intentionally NOT computed here this
   * iteration — the hook keeps its mocked data for those fields until
   * the ClickHouse aggregations land in iter 2. This procedure ships
   * the workspace identity + routing-policy resolution so the page
   * and CLI both have a stable contract to wire against.
   */
  personalContext: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Caller must be a member of the org.
      const membership = await ctx.prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: { userId, organizationId: input.organizationId },
        },
      });
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Not a member of organization ${input.organizationId}`,
        });
      }

      const workspaceService = new PersonalWorkspaceService(ctx.prisma);
      const workspace = await workspaceService.ensure({
        userId,
        organizationId: input.organizationId,
        displayName: ctx.session.user.name,
        displayEmail: ctx.session.user.email,
      });

      const policyService = new RoutingPolicyService(ctx.prisma);
      const defaultPolicy = await policyService.resolveDefaultForUser({
        userId,
        organizationId: input.organizationId,
        personalTeamId: workspace.team.id,
      });

      return {
        workspace,
        routingPolicy: defaultPolicy
          ? { id: defaultPolicy.id, name: defaultPolicy.name }
          : null,
      };
    }),

  /**
   * Per-user usage rollup powering the /me dashboard cards + charts +
   * recent activity. ClickHouse-backed, scoped to the user's personal
   * project (which by definition has only their traces — no cross-user
   * contamination possible).
   *
   * Returns empty-state safe values (zeros, empty arrays, null model)
   * when no traces exist yet, so the page can render before the user's
   * first CLI request lands in CH.
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
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const membership = await ctx.prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: { userId, organizationId: input.organizationId },
        },
      });
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Not a member of organization ${input.organizationId}`,
        });
      }

      // Find the user's personal project. If none yet, return empty-state.
      const workspaceService = new PersonalWorkspaceService(ctx.prisma);
      const workspace = await workspaceService.findExisting({
        userId,
        organizationId: input.organizationId,
      });
      if (!workspace) {
        return {
          summary: {
            spentUsd: 0,
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            mostUsedModel: null,
          },
          dailyBuckets: [],
          breakdownByModel: [],
          recentActivity: [],
        };
      }

      const window =
        input.windowStartMs && input.windowEndMs
          ? {
              start: new Date(input.windowStartMs),
              end: new Date(input.windowEndMs),
            }
          : undefined;

      const usage = new PersonalUsageService();

      // Run the four queries in parallel — they're independent and the
      // CH server happily multiplexes. Cuts wall time roughly in half
      // for the dashboard initial-render p95.
      const [summary, dailyBuckets, breakdownByModel, recentActivity] =
        await Promise.all([
          usage.summary({ personalProjectId: workspace.project.id, window }),
          usage.dailyBuckets({ personalProjectId: workspace.project.id, window }),
          usage.breakdownByModel({
            personalProjectId: workspace.project.id,
            window,
          }),
          usage.recentActivity({
            personalProjectId: workspace.project.id,
            window,
          }),
        ]);

      return {
        summary,
        dailyBuckets,
        breakdownByModel,
        recentActivity,
      };
    }),

  /**
   * Per-user budget state powering the /me dashboard's
   * BudgetExceededBanner. Same wire shape as the CLI 402 payload
   * (cli-reference.mdx "Budget pre-check") so client + CLI render
   * with identical fields.
   *
   * Delegates to GatewayBudgetService.check() with projectedCostUsd=0
   * — same code path the gateway uses at request time, so the UI's
   * banner state and the CLI's pre-check decision can never disagree.
   *
   * Returns:
   *   { status: "ok" }                                 nothing to render
   *   { status: "warning", ...details }                soft_warn (≥80% used)
   *   { status: "exceeded", ...details }               hard_block (≥100% used)
   *
   * Graceful-degradation cases that return {status: "ok"}:
   *   - User has no personal workspace yet
   *   - User has no personal VK yet
   *   - ClickHouse not configured (smaller self-hosters)
   */
  personalBudget: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const workspaceService = new PersonalWorkspaceService(ctx.prisma);
      const workspace = await workspaceService.findExisting({
        userId,
        organizationId: input.organizationId,
      });
      if (!workspace) return { status: "ok" as const };

      const vkService = PersonalVirtualKeyService.create(ctx.prisma);
      const vks = await vkService.list({
        userId,
        organizationId: input.organizationId,
      });
      const personalVk = vks[0];
      if (!personalVk) return { status: "ok" as const };

      const chRepo = isClickHouseEnabled()
        ? new GatewayBudgetClickHouseRepository(async (projectId) => {
            const client = await getClickHouseClientForProject(projectId);
            if (!client) {
              throw new Error(
                `ClickHouse enabled but no client for project ${projectId}`,
              );
            }
            return client;
          })
        : undefined;
      const budgetService = GatewayBudgetService.create(ctx.prisma, chRepo);
      const decision = await budgetService.check({
        organizationId: input.organizationId,
        teamId: workspace.team.id,
        projectId: workspace.project.id,
        virtualKeyId: personalVk.id,
        principalUserId: userId,
        projectedCostUsd: 0,
      });

      // Status mapping: hard_block → exceeded (red banner),
      // soft_warn → warning (yellow banner), allow → ok (no banner).
      if (decision.decision === "allow") return { status: "ok" as const };

      const blocker =
        decision.blockedBy[0] ??
        decision.scopes
          .map((s) => ({ ...s, pctUsed: percentUsed(s.spentUsd, s.limitUsd) }))
          .filter((s) => s.pctUsed >= 80)
          .sort((a, b) => b.pctUsed - a.pctUsed)[0];
      if (!blocker) return { status: "ok" as const };

      const adminEmail = await resolveOrgAdminEmail(
        ctx.prisma,
        input.organizationId,
      );
      const baseStatus =
        decision.decision === "hard_block"
          ? ("exceeded" as const)
          : ("warning" as const);
      return {
        status: baseStatus,
        scope: normalizeScope(blocker.scope),
        spentUsd: blocker.spentUsd,
        limitUsd: blocker.limitUsd,
        period: blocker.window.toLowerCase(),
        requestIncreaseUrl: requestIncreaseUrl({
          baseUrl: env.NEXTAUTH_URL ?? env.BASE_HOST ?? null,
          scope: normalizeScope(blocker.scope),
          scopeId: blocker.scopeId,
          limitUsd: blocker.limitUsd,
          spentUsd: blocker.spentUsd,
        }),
        adminEmail,
      };
    }),

  /**
   * CLI bootstrap data for the Storyboard Screen 4 login-completion
   * ceremony. Returns inherited providers (with display name + model
   * list) + monthly budget (limit + used). Powers the
   * `formatLoginCeremony({ providers, budget })` rich-enrichment
   * variant in typescript-sdk.
   *
   * Wire shape — every field always populated:
   *   {
   *     providers: Array<{ name, displayName, models[] }>;
   *     budget: { monthlyLimitUsd: number | null, monthlyUsedUsd: number, period: string };
   *   }
   *
   * Empty-state safe: returns providers=[] + budget={null, 0, MONTHLY}
   * when the user has no personal workspace yet (fresh login,
   * no admin VK provisioning yet).
   *
   * Per @ai_gateway_andre b8b21bb79 (1.5a-cli-1 ceremony) +
   * Phase 1B.5 fold (5be9a5004).
   */
  cliBootstrap: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = CliBootstrapService.create(ctx.prisma);
      return await service.resolve({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
    }),
});

// ---------------------------------------------------------------------------
// personalBudget helpers
// ---------------------------------------------------------------------------

function percentUsed(spentUsd: string, limitUsd: string): number {
  const limit = Number.parseFloat(limitUsd);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const spent = Number.parseFloat(spentUsd);
  return (spent / limit) * 100;
}

/** Map server-side scope codes to the wire-shape values the
 *  BudgetExceededBanner + CLI Screen-8 box accept. */
function normalizeScope(scope: string): string {
  const s = scope.toLowerCase();
  // VIRTUAL_KEY-scope blocks are surfaced as "personal" in the
  // user-facing banner — that matches the CLI's normalization.
  if (s === "virtual_key") return "personal";
  return s;
}

function requestIncreaseUrl(opts: {
  baseUrl: string | null;
  scope: string;
  scopeId: string;
  limitUsd: string;
  spentUsd: string;
}): string | undefined {
  if (!opts.baseUrl) return undefined;
  const params = new URLSearchParams({
    scope: opts.scope,
    scope_id: opts.scopeId,
    limit_usd: opts.limitUsd,
    spent_usd: opts.spentUsd,
  });
  return `${opts.baseUrl.replace(/\/$/, "")}/me/budget/request?${params.toString()}`;
}

async function resolveOrgAdminEmail(
  prisma: import("@prisma/client").PrismaClient,
  organizationId: string,
): Promise<string | undefined> {
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN" },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return admin?.user.email ?? undefined;
}
