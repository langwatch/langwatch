import { isAdmin } from "@ee/admin/isAdmin";
import type { PlanInfo } from "@ee/licensing/planInfo";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { env } from "~/env.mjs";
import { isEnterpriseTier } from "~/server/api/enterprise";
import {
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
} from "~/server/api/rbac";
import { getApp } from "~/server/app-layer/app";
import type { Session } from "~/server/auth";
import {
  ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
  INDEFINITE_RETENTION_DAYS,
  PAID_RETENTION_PRESET_DAYS,
} from "~/server/data-retention/retentionPolicy.schema";
import type { ScopeTier } from "~/server/scopes/scope.types";

type RBACContext = { prisma: PrismaClient; session: Session | null };

export type RetentionScope = { scopeType: ScopeTier; scopeId: string };

/**
 * Permission required to write a retention override at a given tier.
 *
 * This MUST mirror the read side (`getRetentionPolicySnapshot`), which
 * advertises a scope as writable using exactly these permissions:
 *   - ORGANIZATION → organization:manage
 *   - TEAM         → team:manage
 *   - PROJECT      → project:update
 *
 * PROJECT deliberately uses `project:update`, not `project:manage`: a team
 * MEMBER holds `project:update` but not `project:manage`, and the snapshot
 * already shows them their project as writable. Requiring `project:manage`
 * here (the bug that came from borrowing the model-provider helper) made the
 * chip picker offer a scope that the save then rejected with FORBIDDEN. It
 * also keeps these mutations consistent with the retroactive endpoints, which
 * gate on `project:update`.
 */
export function requiredRetentionWritePermission(
  scopeType: ScopeTier,
): "organization:manage" | "team:manage" | "project:update" {
  if (scopeType === "ORGANIZATION") return "organization:manage";
  if (scopeType === "TEAM") return "team:manage";
  return "project:update";
}

async function canWriteScope(
  ctx: RBACContext,
  scope: RetentionScope,
): Promise<boolean> {
  if (!ctx.session) return false;
  if (scope.scopeType === "ORGANIZATION") {
    return hasOrganizationPermission(
      { prisma: ctx.prisma, session: ctx.session },
      scope.scopeId,
      "organization:manage",
    );
  }
  if (scope.scopeType === "TEAM") {
    return hasTeamPermission(ctx, scope.scopeId, "team:manage");
  }
  return hasProjectPermission(ctx, scope.scopeId, "project:update");
}

/**
 * Throws FORBIDDEN if the caller cannot write a retention override at the
 * given scope. The required permission matches what the read snapshot uses to
 * decide the scope is writable, so the UI never offers a scope the save will
 * reject.
 */
export async function assertCanWriteRetentionScope(
  ctx: RBACContext,
  scope: RetentionScope,
): Promise<void> {
  if (await canWriteScope(ctx, scope)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `You need ${requiredRetentionWritePermission(
      scope.scopeType,
    )} on this ${scope.scopeType.toLowerCase()} to change its data retention.`,
  });
}

/**
 * Disabling retention (keep data indefinitely, exempt from TTL deletion) is a
 * platform-level capability, NOT a customer tier. Restrict it to platform
 * administrators — the `ADMIN_EMAILS` allow-list, distinct from organization
 * admins: an org admin configures finite retention, but only a platform admin
 * may opt data out of deletion entirely. The UI hides the option from everyone
 * else; this is the matching server-side enforcement (never trust the client).
 */
export function assertCanDisableRetention(ctx: RBACContext): void {
  if (isAdmin({ email: ctx.session?.user?.email })) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "Only platform administrators can disable data retention " +
      "(keep data indefinitely).",
  });
}

/**
 * Whether the organization's plan unlocks per-scope retention overrides.
 * Free plans get the platform-wide default (DEFAULT_RETENTION_DAYS) and
 * cannot configure anything else. Read snapshots and the chip picker also
 * call this, so the UI never offers a control the save will reject.
 */
export async function canConfigureRetention(
  organizationId: string | null,
  user: Session["user"] | null,
): Promise<boolean> {
  if (!organizationId) return false;
  const plan = await getApp().planProvider.getActivePlan({
    organizationId,
    user: user ?? undefined,
  });
  return !plan.free;
}

/**
 * Throws FORBIDDEN if the org is on a free plan. Retention overrides and
 * retroactive mutations are paid-tier features; free plans use the platform
 * default uniformly. Called from every mutation that writes retention state.
 */
export async function assertRetentionPlan(
  ctx: RBACContext,
  organizationId: string,
): Promise<void> {
  if (await canConfigureRetention(organizationId, ctx.session?.user ?? null)) {
    return;
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "Configuring data retention is a paid-plan feature. " +
      "All projects use the platform default until the organization upgrades.",
  });
}

/**
 * Resolves the organization that owns a scope target (org/team/project).
 * Returns null if the scope does not exist or doesn't resolve to an org —
 * callers should treat that as NOT_FOUND.
 */
export async function resolveScopeOrganizationId(
  ctx: RBACContext,
  scope: RetentionScope,
): Promise<string | null> {
  if (scope.scopeType === "ORGANIZATION") {
    const org = await ctx.prisma.organization.findUnique({
      where: { id: scope.scopeId },
      select: { id: true },
    });
    return org?.id ?? null;
  }
  if (scope.scopeType === "TEAM") {
    const team = await ctx.prisma.team.findUnique({
      where: { id: scope.scopeId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }
  const project = await ctx.prisma.project.findUnique({
    where: { id: scope.scopeId },
    select: { team: { select: { organizationId: true } } },
  });
  return project?.team?.organizationId ?? null;
}

/**
 * Plan-gate a scope-targeted retention mutation against the organization
 * that owns the scope — NOT against the caller-supplied projectId.
 *
 * Without this, a caller who manages a scope in a free org and also has a
 * paid project elsewhere could pass that paid project id alongside the
 * free-org scope and bypass the paid-tier gate. Tie the plan check to the
 * scope's owning org so the gate matches the mutation target.
 */
export async function assertRetentionPlanForScope(
  ctx: RBACContext,
  scope: RetentionScope,
): Promise<void> {
  const organizationId = await resolveScopeOrganizationId(ctx, scope);
  if (!organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${scope.scopeType.toLowerCase()} ${scope.scopeId} was not found.`,
    });
  }
  await assertRetentionPlan(ctx, organizationId);
}

/**
 * Which retention values a plan tier may persist. Deliberately a standalone
 * map inside the retention module rather than a field on `PlanInfo` /
 * `PLAN_LIMITS` / the signed license: retention packaging owns its own tiering
 * and stays decoupled from billing/license plumbing. It reads only existing
 * `PlanInfo` fields (`free`, `type`), so a license-resolved org can never crash
 * on a missing field.
 *
 * Tiering is by exclusion: enterprise (`isEnterpriseTier`) and self-hosted
 * (`!IS_SAAS`) are uncapped; every other non-free SaaS plan is "paid". An
 * unrecognised SaaS tier therefore fails CLOSED to the restrictive paid menu —
 * the data-loss-safe default (a mis-tiered org can't set an arbitrary window),
 * not fail-open. If a new enterprise-like tier is added, extend
 * `isEnterpriseTier` (the app-wide enterprise check) so it resolves to uncapped.
 *
 * - `fixed`   → paid (non-enterprise SaaS): only the listed presets, no custom.
 * - `uncapped`→ enterprise / self-hosted: any whole-week value ≥ `customMin`,
 *               plus the paid short presets (35/63) as the sole sub-floor
 *               exceptions.
 */
type RetentionRule =
  | { kind: "fixed"; presetDays: readonly number[] }
  | { kind: "uncapped"; customMin: number };

function ruleForPlan(plan: PlanInfo): RetentionRule {
  // Self-hosted / OSS short-circuits to ENTERPRISE upstream, but guard on
  // IS_SAAS too so a mis-resolved plan on a self-hosted deploy is never capped.
  if (env.IS_SAAS !== true || isEnterpriseTier(plan.type)) {
    return {
      kind: "uncapped",
      customMin: ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
    };
  }
  return { kind: "fixed", presetDays: PAID_RETENTION_PRESET_DAYS };
}

/**
 * Throws FORBIDDEN if the plan of the scope's owning org may not persist the
 * requested retention value. This is the write-path prevention that stops a
 * paid org from setting an arbitrary (e.g. custom multi-year) window through
 * the tRPC surface, independent of what the UI offers.
 *
 * Order matters at the call site: run AFTER the free gate
 * (`assertRetentionPlanForScope`) and it no-ops on the indefinite sentinel so
 * the platform-admin `assertCanDisableRetention` check still runs downstream.
 * Only `setForScope` (the one place a NEW value is chosen) calls this;
 * retroactive apply replays an already-stored value and is NOT value-gated.
 */
export async function assertRetentionValueAllowedForPlan(
  ctx: RBACContext,
  scope: RetentionScope,
  retentionDays: number,
): Promise<void> {
  // Keep-forever (0) is authorized separately (platform-admin only). Returning
  // here lets that gate run and keeps the value rule from rejecting the
  // sentinel as "not a preset".
  if (retentionDays === INDEFINITE_RETENTION_DAYS) return;

  const organizationId = await resolveScopeOrganizationId(ctx, scope);
  if (!organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${scope.scopeType.toLowerCase()} ${scope.scopeId} was not found.`,
    });
  }

  const plan = await getApp().planProvider.getActivePlan({
    organizationId,
    user: ctx.session?.user ?? undefined,
  });

  // Free orgs are blocked upstream by the free gate; don't double-enforce the
  // value rule (which would otherwise reject their platform-default resolution).
  if (plan.free) return;

  const rule = ruleForPlan(plan);

  if (rule.kind === "uncapped") {
    // The paid short presets (35/63) are the only values allowed below the
    // enterprise custom floor. Everything else must clear the floor; whole-week
    // alignment is already enforced by `retentionDaysSchema`.
    if (
      (PAID_RETENTION_PRESET_DAYS as readonly number[]).includes(retentionDays)
    ) {
      return;
    }
    if (retentionDays < rule.customMin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Retention must be at least ${rule.customMin} days on your plan.`,
      });
    }
    return;
  }

  if (!rule.presetDays.includes(retentionDays)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "That retention length isn't available on your plan. " +
        "Choose one of the offered options, or contact us to unlock more.",
    });
  }
}
