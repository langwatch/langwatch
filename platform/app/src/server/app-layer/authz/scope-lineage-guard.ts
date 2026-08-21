import {
  type AuthzDeclaration,
  BINDING_SCOPE_TIERS,
  type BindingScopeTier,
  PermissionDeniedError,
  SCOPE_TIER_FIELDS,
} from "@langwatch/authz";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "~/generated/prisma/client";

const logger = createLogger("langwatch:authz:scope-lineage");

/**
 * The cross-tenant half of the shadowing class the declaration sweep closes
 * statically (specs/rbac/typed-permission-declarations.feature): a check that
 * passes on one scope id while the handler acts on another is only an
 * EXPLOIT when the two ids belong to different tenants — your own projectId
 * satisfying the check while someone else's organizationId anchors the
 * query. The sweep can refuse that shape for declarations it can see
 * through; a custom middleware's enforcement is a black box to it, and a
 * future resolver bug is invisible to any static check.
 *
 * So this guard removes the precondition instead: every scope id one request
 * carries must resolve to the SAME organization, or the request is refused
 * before any permission check runs — whatever the declaration kind in front
 * of it. Cross-team moves inside one organization still pass; aiming any id
 * at another tenant no longer can, anywhere.
 *
 * Fail closed: an id that resolves to no organization at all cannot prove
 * agreement, so a mixed request carrying one is refused too. The refusal is
 * indistinguishable from an ordinary permission denial — same code, same
 * shape — so no probe can pair ids to learn which organization a project
 * belongs to. The real cause goes to the log line.
 */

type LineagePrisma = Pick<PrismaClient, "team" | "project">;

type LineageMiddlewareParams = {
  ctx: { prisma: LineagePrisma };
  input: unknown;
  next: () => any;
};

type PresentScopeId = { tier: BindingScopeTier; id: string };

/** Widest tier last, matching BINDING_SCOPE_TIERS' most-specific-first order. */
function widestOf(entries: readonly PresentScopeId[]): PresentScopeId {
  return [...entries].sort(
    (a, b) =>
      BINDING_SCOPE_TIERS.indexOf(b.tier) - BINDING_SCOPE_TIERS.indexOf(a.tier),
  )[0]!;
}

function presentScopeIds(input: unknown): PresentScopeId[] {
  if (typeof input !== "object" || input === null) return [];
  const record = input as Record<string, unknown>;
  return BINDING_SCOPE_TIERS.flatMap((tier) => {
    const id = record[SCOPE_TIER_FIELDS[tier]];
    return typeof id === "string" && id.length > 0 ? [{ tier, id }] : [];
  });
}

async function organizationOfScopeId({
  prisma,
  tier,
  id,
}: PresentScopeId & { prisma: LineagePrisma }): Promise<string | null> {
  switch (tier) {
    case "organization":
      return id;
    case "team": {
      const team = await prisma.team.findUnique({
        where: { id },
        select: { organizationId: true },
      });
      return team?.organizationId ?? null;
    }
    case "project": {
      const project = await prisma.project.findUnique({
        where: { id },
        select: { team: { select: { organizationId: true } } },
      });
      return project?.team.organizationId ?? null;
    }
  }
}

/** The permission the denial names in `meta` — the one the route declared,
 *  so the client's remediation copy stays actionable; empty when the route
 *  deliberately opted out and there is nothing to ask an admin for. */
function declaredPermissionOf(declaration: AuthzDeclaration | null): string {
  switch (declaration?.kind) {
    case "permission":
      return declaration.permission;
    case "permission-any":
    case "custom":
    case "service-authorized":
      return declaration.permissions[0] ?? "";
    default:
      return "";
  }
}

/**
 * A transparent middleware (it never sets `permissionChecked`) that runs
 * ahead of every declared or custom check `withPermissionCheck` assembles.
 * A request carrying at most one scope id costs nothing; one carrying more
 * costs at most two primary-key reads.
 */
export function scopeLineageGuard(declaration: AuthzDeclaration | null) {
  return async ({ ctx, input, next }: LineageMiddlewareParams) => {
    const present = presentScopeIds(input);
    if (present.length < 2) return next();

    const resolved = await Promise.all(
      present.map(async (entry) => ({
        ...entry,
        organizationId: await organizationOfScopeId({
          prisma: ctx.prisma,
          ...entry,
        }),
      })),
    );
    const organizations = new Set(resolved.map((r) => r.organizationId));
    if (organizations.size === 1 && !organizations.has(null)) return next();

    const widest = widestOf(present);
    logger.warn(
      { scopes: resolved },
      "refused: one request carries scope ids that do not resolve to one organization",
    );
    throw new TRPCError({
      // The wire code becomes FORBIDDEN: `handledErrorMiddleware` re-derives
      // it from the handled cause's httpStatus (403), exactly as the declared
      // checks' own denials do.
      code: "UNAUTHORIZED",
      message: `You do not have permission to access this ${widest.tier}`,
      cause: new PermissionDeniedError({
        permission: declaredPermissionOf(declaration),
        scope: { type: widest.tier, id: widest.id },
        denialReason: "no-membership",
      }),
    });
  };
}
