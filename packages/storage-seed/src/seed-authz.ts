/**
 * Seeded grants land where the authz engine reads them: the `Grant` and `Role`
 * projections, with the compat `RoleBinding` row kept aligned under the same
 * id. Ported from main's platform/app/prisma/seed-authz.ts.
 */
import {
  bindingRoleKeyOf,
  STORED_PRINCIPAL_KIND,
  type GrantEventSource,
} from "@langwatch/authz-contract";
import type {
  Prisma,
  PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/prisma-client/generated";
import { fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";

const SEED_GRANT_SOURCE: GrantEventSource = "grants-service";

export type SeedGrantBinding = {
  id: string;
  organizationId: string;
  principal: { type: "user" | "apiKey"; id: string };
  role: TeamUserRole;
  customRoleId?: string | null;
  scope: { type: RoleBindingScopeType; id: string };
};

export type SeedRoleProjection = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: string[];
  kind: "custom" | "system_api_key";
};

const LOCAL_DEV_BINDING_IDS = {
  adminOrganization: "local-dev-admin-organization-binding",
  adminTeam: "local-dev-admin-team-binding",
  privateToken: "local-dev-private-token-binding",
  publicToken: "local-dev-public-token-binding",
} as const;

export function adminGrantBindings({
  organizationId,
  teamId,
  userId,
}: {
  organizationId: string;
  teamId: string;
  userId: string;
}): SeedGrantBinding[] {
  const principal: SeedGrantBinding["principal"] = { type: "user", id: userId };
  return [
    {
      id: LOCAL_DEV_BINDING_IDS.adminOrganization,
      organizationId,
      principal,
      role: "ADMIN",
      scope: { type: "ORGANIZATION", id: organizationId },
    },
    {
      id: LOCAL_DEV_BINDING_IDS.adminTeam,
      organizationId,
      principal,
      role: "ADMIN",
      scope: { type: "TEAM", id: teamId },
    },
  ];
}

/** The private access token: a full-access personal token, ORGANIZATION-scope ADMIN. */
export function privateTokenGrantBinding({
  organizationId,
  apiKeyId,
}: {
  organizationId: string;
  apiKeyId: string;
}): SeedGrantBinding {
  return {
    id: LOCAL_DEV_BINDING_IDS.privateToken,
    organizationId,
    principal: { type: "apiKey", id: apiKeyId },
    role: "ADMIN",
    scope: { type: "ORGANIZATION", id: organizationId },
  };
}

/** The public ingestion token: its restricted custom role, on one project. */
export function publicTokenGrantBinding({
  organizationId,
  projectId,
  apiKeyId,
  roleId,
}: {
  organizationId: string;
  projectId: string;
  apiKeyId: string;
  roleId: string;
}): SeedGrantBinding {
  return {
    id: LOCAL_DEV_BINDING_IDS.publicToken,
    organizationId,
    principal: { type: "apiKey", id: apiKeyId },
    role: "CUSTOM",
    customRoleId: roleId,
    scope: { type: "PROJECT", id: projectId },
  };
}

export function grantRowFor({
  binding,
  occurredAt,
}: {
  binding: SeedGrantBinding;
  occurredAt: Instant;
}): Prisma.GrantUncheckedCreateInput {
  return {
    id: binding.id,
    organizationId: binding.organizationId,
    principalType: STORED_PRINCIPAL_KIND[binding.principal.type],
    principalId: binding.principal.id,
    roleKey: bindingRoleKeyOf({
      role: binding.role,
      customRoleId: binding.customRoleId ?? null,
    }),
    legacyRole: binding.role,
    source: SEED_GRANT_SOURCE,
    scopeType: binding.scope.type,
    scopeId: binding.scope.id,
    occurredAt: toDate(occurredAt),
  };
}

export function compatRoleBindingFor(
  binding: SeedGrantBinding,
): Prisma.RoleBindingUncheckedCreateInput {
  return {
    id: binding.id,
    organizationId: binding.organizationId,
    userId: binding.principal.type === "user" ? binding.principal.id : null,
    apiKeyId: binding.principal.type === "apiKey" ? binding.principal.id : null,
    role: binding.role,
    customRoleId: binding.customRoleId ?? null,
    scopeType: binding.scope.type,
    scopeId: binding.scope.id,
  };
}

export function roleRowFor({
  role,
  occurredAt,
}: {
  role: SeedRoleProjection;
  occurredAt: Instant;
}): Prisma.RoleUncheckedCreateInput {
  return {
    id: role.id,
    organizationId: role.organizationId,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    kind: role.kind,
    occurredAt: toDate(occurredAt),
  };
}

/** Refuses to recreate a grant a previous run saw revoked, and says so with `false`. */
export async function seedGrantBinding({
  prisma,
  binding,
}: {
  prisma: PrismaClient;
  binding: SeedGrantBinding;
}): Promise<boolean> {
  return prisma.$transaction((tx) => seedGrantBindingInTransaction({ tx, binding }));
}

async function seedGrantBindingInTransaction({
  tx,
  binding,
}: {
  tx: Prisma.TransactionClient;
  binding: SeedGrantBinding;
}): Promise<boolean> {
  const existing = await tx.grant.findUnique({
    where: { id: binding.id },
    select: { revokedAt: true, occurredAt: true },
  });
  if (existing?.revokedAt) {
    await tx.roleBinding.deleteMany({ where: { id: binding.id } });
    return false;
  }

  const { id: bindingId, ...bindingUpdate } = compatRoleBindingFor(binding);
  await tx.roleBinding.upsert({
    where: { id: bindingId },
    create: compatRoleBindingFor(binding),
    update: bindingUpdate,
  });
  const occurredAt = existing ? fromDate(existing.occurredAt) : nowInstant();
  const grant = grantRowFor({ binding, occurredAt });
  const { id: grantId, ...grantUpdate } = grant;
  await tx.grant.upsert({ where: { id: grantId }, create: grant, update: grantUpdate });
  return true;
}

/** Refuses to recreate a role a previous run saw deleted, and says so with `false`. */
export async function seedRoleProjection({
  prisma,
  role,
}: {
  prisma: PrismaClient;
  role: SeedRoleProjection;
}): Promise<boolean> {
  const existing = await prisma.role.findUnique({
    where: { id: role.id },
    select: { deletedAt: true, occurredAt: true },
  });
  if (existing?.deletedAt) return false;

  const occurredAt = existing ? fromDate(existing.occurredAt) : nowInstant();
  const row = roleRowFor({ role, occurredAt });
  const { id: roleId, ...roleUpdate } = row;
  await prisma.role.upsert({ where: { id: roleId }, create: row, update: roleUpdate });
  return true;
}
