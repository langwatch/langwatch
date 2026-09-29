import type { AuthzPermission, AuthzPrincipalRef } from "@langwatch/authz";
import type { PrismaClient } from "~/generated/prisma/client";
import { authzChecksFor } from "./checks";

export type ScopeRef =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

export type Principal = Extract<AuthzPrincipalRef, { type: "user" | "apiKey" }>;

/** Checks the named principal's grants without applying an API-key owner ceiling. */
export async function checkPrincipalPermission({
  prisma,
  userId,
  principal,
  organizationId,
  scope,
  permission,
}: {
  prisma: PrismaClient;
  userId?: string;
  principal?: Principal;
  organizationId: string;
  scope: ScopeRef;
  permission: AuthzPermission;
}): Promise<boolean> {
  const resolved =
    principal ?? (userId ? { type: "user" as const, id: userId } : null);
  if (!resolved) return false;
  const decision = await authzChecksFor(prisma).checkByIds({
    principal: resolved,
    permission,
    ceiling: false,
    ...scopeRefToIds(scope, organizationId),
  });
  return decision.allowed;
}

function scopeRefToIds(
  scope: ScopeRef,
  organizationId: string,
): { projectId?: string; teamId?: string; organizationId?: string } {
  switch (scope.type) {
    case "project":
      return { projectId: scope.id };
    case "team":
      return { teamId: scope.id };
    case "org":
      return { organizationId };
  }
}

/** The engine resolves the stored owner and intersects its grants with the key's. */
export async function resolveApiKeyPermission({
  prisma,
  apiKeyId,
  organizationId,
  scope,
  permission,
}: {
  prisma: PrismaClient;
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
  scope: ScopeRef;
  permission: AuthzPermission;
}): Promise<boolean> {
  const decision = await authzChecksFor(prisma).checkByIds({
    principal: { type: "apiKey", id: apiKeyId },
    permission,
    ...scopeRefToIds(scope, organizationId),
  });
  return decision.allowed;
}

/** Collect once for every project and permission in the request. */
export async function resolveApiKeyPermissionProjectBatch({
  prisma,
  apiKeyId,
  organizationId,
  projects,
  permissions,
}: {
  prisma: PrismaClient;
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
  projects: ReadonlyArray<{ projectId: string; teamId: string }>;
  permissions: readonly AuthzPermission[];
}): Promise<Map<AuthzPermission, Map<string, boolean>>> {
  const { byPermission } = await authzChecksFor(
    prisma,
  ).canBatchPermissionsByIds({
    principal: { type: "apiKey", id: apiKeyId },
    permissions,
    organizationId,
    teams: [],
    projects,
  });
  return new Map(
    permissions.map((permission) => [
      permission,
      byPermission.get(permission)?.projects ?? new Map<string, boolean>(),
    ]),
  );
}
