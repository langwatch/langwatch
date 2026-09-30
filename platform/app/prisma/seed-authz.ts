import { roleKeyForTeamRole } from "@langwatch/authz";
import type { CompatBindingRowShape, GrantFact } from "@langwatch/authz-server";
import {
  grantFactToCompatBinding,
  grantFactToRow,
  roleFactToRow,
} from "@langwatch/authz-server";
import type {
  Prisma,
  PrismaClient,
  TeamUserRole,
} from "../src/generated/prisma/client";

type SeedGrantBinding = {
  id: string;
  organizationId: string;
  principal: { type: "user" | "apiKey"; id: string };
  role: TeamUserRole;
  customRoleId?: string | null;
  scope: {
    type: "ORGANIZATION" | "TEAM" | "PROJECT";
    id: string;
  };
};

export async function seedGrantBinding(
  prisma: PrismaClient,
  binding: SeedGrantBinding,
): Promise<boolean> {
  return prisma.$transaction((tx) =>
    seedGrantBindingInTransaction(tx, binding),
  );
}

async function seedGrantBindingInTransaction(
  tx: Prisma.TransactionClient,
  binding: SeedGrantBinding,
): Promise<boolean> {
  const existingGrant = await tx.grant.findUnique({
    where: { id: binding.id },
    select: { revokedAt: true, occurredAt: true },
  });
  if (existingGrant?.revokedAt) {
    await tx.roleBinding.deleteMany({ where: { id: binding.id } });
    return false;
  }

  const grant = grantFactFor({
    binding,
    occurredAtMs: existingGrant?.occurredAt.getTime() ?? Date.now(),
  });
  const grantRow = grantFactToRow({
    organizationId: binding.organizationId,
    grant,
  });
  const { id: grantId, ...grantUpdate } = grantRow;
  await upsertRoleBinding(
    tx,
    grantFactToCompatBinding({
      grant,
      organizationId: binding.organizationId,
    }),
  );
  await tx.grant.upsert({
    where: { id: grantId },
    create: grantRow,
    update: grantUpdate,
  });
  return true;
}

function grantFactFor({
  binding,
  occurredAtMs,
}: {
  binding: SeedGrantBinding;
  occurredAtMs: number;
}): GrantFact {
  return {
    grantId: binding.id,
    principal: binding.principal,
    roleKey: binding.customRoleId
      ? `custom:${binding.customRoleId}`
      : roleKeyForTeamRole(binding.role),
    legacyRole: binding.role,
    scope: binding.scope,
    source: "grants-service",
    occurredAtMs,
  };
}

function upsertRoleBinding(
  tx: Prisma.TransactionClient,
  binding: CompatBindingRowShape,
) {
  const { id, ...update } = binding;
  return tx.roleBinding.upsert({
    where: { id },
    create: binding,
    update,
  });
}

export async function seedRoleProjection({
  prisma,
  id,
  organizationId,
  name,
  description,
  permissions,
  kind,
}: {
  prisma: PrismaClient;
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: string[];
  kind: "custom" | "system_api_key";
}): Promise<boolean> {
  const existingRole = await prisma.role.findUnique({
    where: { id },
    select: { deletedAt: true, occurredAt: true },
  });
  if (existingRole?.deletedAt) return false;

  const roleRow = roleFactToRow({
    organizationId,
    role: {
      roleId: id,
      name,
      description: description ?? void 0,
      permissions,
      kind,
      occurredAtMs: existingRole?.occurredAt.getTime() ?? Date.now(),
    },
  });
  const { id: roleId, ...roleUpdate } = roleRow;
  await prisma.role.upsert({
    where: { id: roleId },
    create: roleRow,
    update: roleUpdate,
  });
  return true;
}
