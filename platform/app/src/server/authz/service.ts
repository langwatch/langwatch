/**
 * ADR-092 §11 — the checking API. Named parameters, typed permission
 * strings, one collect feeding any number of decisions.
 *
 *   await can({ prisma, principal, permission: "prompts:update", scope })
 *   await require_({ ... })            → Authorized witness, or throws
 *   await check({ ... })               → full AuthzDecision, never throws
 *   await effectivePermissions({ ... }) → string[] (feeds useCan)
 */
import type { PrismaClient } from "@prisma/client";
import { collectGrantsCached } from "./cache";
import { collectResourceGrants } from "./collector";
import {
  type AuthzDecision,
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  decide,
  explain,
  type ResourceGrant,
  scopeOrganizationId,
} from "./engine";
import { PermissionDeniedError } from "./errors";
import { ALL_PERMISSIONS, type AuthzPermission } from "./registry";
import { type Authorized, mintWitness } from "./witness";

function demoProjectId(): string | undefined {
  // Mirrors isDemoProject()'s dynamic read so tests can vary it per case.
  return process.env.DEMO_PROJECT_ID ?? undefined;
}

async function resourceGrantsFor({
  prisma,
  scope,
}: {
  prisma: PrismaClient;
  scope: AuthzScopeRef;
}): Promise<readonly ResourceGrant[] | undefined> {
  if (scope.type !== "resource") return undefined;
  return collectResourceGrants({ prisma, scope });
}

export async function check({
  prisma,
  principal,
  permission,
  scope,
}: {
  prisma: PrismaClient;
  principal: AuthzPrincipalRef;
  permission: AuthzPermission;
  scope: AuthzScopeRef;
}): Promise<AuthzDecision> {
  const [grants, resourceGrants] = await Promise.all([
    collectGrantsCached({
      prisma,
      principal,
      organizationId: scopeOrganizationId(scope),
    }),
    resourceGrantsFor({ prisma, scope }),
  ]);
  return decide({
    grants,
    permission,
    scope,
    demoProjectId: demoProjectId(),
    resourceGrants,
  });
}

export async function can(args: {
  prisma: PrismaClient;
  principal: AuthzPrincipalRef;
  permission: AuthzPermission;
  scope: AuthzScopeRef;
}): Promise<boolean> {
  const decision = await check(args);
  return decision.allowed;
}

/**
 * Check and throw on denial; on success returns the Authorized witness for
 * the scope, the only proof object repositories following the witness
 * convention accept (ADR-092 §7 L3).
 */
export async function require_<S extends AuthzScopeRef["type"]>(args: {
  prisma: PrismaClient;
  principal: AuthzPrincipalRef;
  permission: AuthzPermission;
  scope: Extract<AuthzScopeRef, { type: S }>;
}): Promise<Authorized<S>> {
  const decision = await check(args);
  if (!decision.allowed) {
    throw new PermissionDeniedError({
      permission: args.permission,
      scope: args.scope,
      denialReason: decision.denialReason ?? "no-binding",
    });
  }
  return mintWitness({
    scope: args.scope,
    permission: args.permission,
    decision,
  });
}

/**
 * The caller's full effective permission set at a scope — the frontend's
 * single source of truth (useCan). Computed by testing the whole registry
 * against one collected snapshot: pure decides over ~110 permissions.
 */
export async function effectivePermissions({
  prisma,
  principal,
  scope,
}: {
  prisma: PrismaClient;
  principal: AuthzPrincipalRef;
  scope: AuthzScopeRef;
}): Promise<AuthzPermission[]> {
  const [grants, resourceGrants] = await Promise.all([
    collectGrantsCached({
      prisma,
      principal,
      organizationId: scopeOrganizationId(scope),
    }),
    resourceGrantsFor({ prisma, scope }),
  ]);
  const demo = demoProjectId();
  return ALL_PERMISSIONS.filter(
    (permission) =>
      decide({ grants, permission, scope, demoProjectId: demo, resourceGrants })
        .allowed,
  );
}

/**
 * ADR-092 §6 — render the walk for a decision, recollecting the snapshot the
 * decision was made against.
 */
export async function explainDecision({
  prisma,
  decision,
}: {
  prisma: PrismaClient;
  decision: AuthzDecision;
}): Promise<string[]> {
  const grants = await collectGrantsCached({
    prisma,
    principal: decision.principal,
    organizationId: scopeOrganizationId(decision.scope),
  });
  return explain({ decision, grants });
}
