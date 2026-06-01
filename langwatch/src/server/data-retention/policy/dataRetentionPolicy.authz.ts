import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
} from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import { getApp } from "~/server/app-layer/app";
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
