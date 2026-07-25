/**
 * Creates a credential-auth login for the guardrail QA fixtures.
 *
 * Mirrors scripts/seed-dogfood-password.ts, but joins the QA org and team
 * created by qa-seed-guardrail.ts instead of copying another user's graph.
 * Keeps OrganizationUser, TeamUser and RoleBinding in lockstep, which is what
 * the RBAC checks actually read.
 *
 * Usage: pnpm tsx .claude/qa-seed-login.ts <organizationId> <teamId>
 */
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { hash } from "bcrypt";

import { prisma } from "../src/server/db";

const EMAIL = process.env.QA_USER_EMAIL ?? "guardrail-qa@langwatch.local";
const PASSWORD = process.env.QA_USER_PASSWORD ?? "GuardrailQA!2026";

async function main() {
  const [organizationId, teamId] = process.argv.slice(2);
  if (!organizationId || !teamId) {
    throw new Error("usage: qa-seed-login.ts <organizationId> <teamId>");
  }

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  user ??= await prisma.user.create({
    data: { email: EMAIL, name: "Guardrail QA", emailVerified: true },
  });

  const hashed = await hash(PASSWORD, 10);
  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: "credential" },
  });
  if (account) {
    await prisma.account.update({
      where: { id: account.id },
      data: { password: hashed },
    });
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        provider: "credential",
        providerAccountId: user.id,
        type: "credentials",
        password: hashed,
      },
    });
  }

  await prisma.organizationUser.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    create: { userId: user.id, organizationId, role: "ADMIN" },
    update: {},
  });
  await prisma.teamUser.upsert({
    where: { userId_teamId: { userId: user.id, teamId } },
    create: { userId: user.id, teamId, role: "ADMIN" },
    update: {},
  });

  await prisma.roleBinding.deleteMany({ where: { userId: user.id, organizationId } });
  await prisma.roleBinding.create({
    data: {
      organizationId,
      userId: user.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId,
      userId: user.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
  });

  console.log("Sign in with:");
  console.log("  email:   ", EMAIL);
  console.log("  password:", PASSWORD);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
