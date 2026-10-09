/**
 * The fixed local identity's grants and the public token's role, sent as authz commands so
 * the worker's projections write every row (dev/docs/plans/seed-2026-10-09.md §3.1).
 */
import {
  newAuthzGrantId,
  type AuthzApi,
  type AuthzDefineRoleInput,
  type AuthzLedgerBindingAttach,
} from "@langwatch/authz-contract";

export type SeedGrant = Omit<AuthzLedgerBindingAttach, "bindingId">;
export type SeedRole = Omit<AuthzDefineRoleInput, "organizationId" | "actor">;

const SYSTEM_ACTOR = { type: "system", id: null } as const;

/** ORGANIZATION-scope and TEAM-scope ADMIN: the admin's, and each tool user's. */
export function adminGrants({
  organizationId,
  teamId,
  userId,
}: {
  organizationId: string;
  teamId: string;
  userId: string;
}): SeedGrant[] {
  const grant = { principal: { userId }, role: "ADMIN", customRoleId: null } as const;
  return [
    { ...grant, scopeType: "ORGANIZATION", scopeId: organizationId },
    { ...grant, scopeType: "TEAM", scopeId: teamId },
  ];
}

/** The private access token: a full-access personal token, ORGANIZATION-scope ADMIN. */
export function privateTokenGrant({
  organizationId,
  apiKeyId,
}: {
  organizationId: string;
  apiKeyId: string;
}): SeedGrant {
  return {
    principal: { apiKeyId },
    role: "ADMIN",
    customRoleId: null,
    scopeType: "ORGANIZATION",
    scopeId: organizationId,
  };
}

/** The public ingestion token: its restricted role, on one project. */
export function publicTokenGrant({
  projectId,
  apiKeyId,
  roleId,
}: {
  projectId: string;
  apiKeyId: string;
  roleId: string;
}): SeedGrant {
  return {
    principal: { apiKeyId },
    role: "CUSTOM",
    customRoleId: roleId,
    scopeType: "PROJECT",
    scopeId: projectId,
  };
}

/**
 * Defines the roles, then attaches the grants a principal does not already hold. The operator
 * running the seed writes as `system`. A stack whose worker is not up yet does not fail the seed:
 * the commands are durable and project once it drains.
 */
export async function attachSeedGrants({
  authz,
  organizationId,
  roles,
  grants,
}: {
  authz: Pick<AuthzApi, "defineRole" | "attachBindings">;
  organizationId: string;
  roles: SeedRole[];
  grants: SeedGrant[];
}): Promise<void> {
  for (const role of roles) {
    await authz.defineRole({
      ...role,
      organizationId,
      actor: SYSTEM_ACTOR,
      requireProjection: false,
    });
  }
  await authz.attachBindings({
    organizationId,
    bindings: grants.map((grant) => ({ ...grant, bindingId: newAuthzGrantId() })),
    caller: { type: "system" },
    actor: SYSTEM_ACTOR,
    onDuplicate: "skip",
    awaitProjection: true,
    requireProjection: false,
  });
}
