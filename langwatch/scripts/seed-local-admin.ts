/**
 * Fresh-install local admin seed.
 *
 * Creates one Organization + Team + Project + admin User with credential
 * auth, plus the matching OrganizationUser / TeamUser / RoleBinding rows
 * so the user gets ADMIN access immediately. Idempotent — re-running on
 * an already-seeded DB updates the password and skips existing rows.
 *
 * Usage (from /app inside the langwatch container, or with the right
 * DATABASE_URL exported):
 *   pnpm tsx scripts/seed-local-admin.ts
 *
 * Env (all optional):
 *   SEED_USER_EMAIL    — login email (default: admin@local.langwatch.dev)
 *   SEED_USER_PASSWORD — login password (default: LocalAdmin!2026)
 *   SEED_USER_NAME     — display name (default: Local Admin)
 *   SEED_ORG_NAME      — org name (default: Local Dev Organization)
 *   SEED_TEAM_NAME     — team name (default: Local Dev Team)
 *   SEED_PROJECT_NAME  — project name (default: Local Dev Project)
 */
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { hash } from "bcrypt";
import { nanoid } from "nanoid";
import { prisma } from "../src/server/db";
import { LOCAL_DEV_ENTERPRISE_LICENSE_KEY } from "./localDevLicense";

async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.SEED_USER_PASSWORD
  ) {
    throw new Error(
      "Refusing to seed a hardcoded default admin credential with NODE_ENV=production. " +
        "Set SEED_USER_PASSWORD explicitly if you really intend to seed an admin user here.",
    );
  }

  const email = process.env.SEED_USER_EMAIL ?? "admin@local.langwatch.dev";
  const password = process.env.SEED_USER_PASSWORD ?? "LocalAdmin!2026";
  const name = process.env.SEED_USER_NAME ?? "Local Admin";
  const orgName = process.env.SEED_ORG_NAME ?? "Local Dev Organization";
  const teamName = process.env.SEED_TEAM_NAME ?? "Local Dev Team";
  const projectName = process.env.SEED_PROJECT_NAME ?? "Local Dev Project";
  const hashed = await hash(password, 10);

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name, emailVerified: true },
    });
    console.log(`Created user ${user.id}`);
  } else {
    console.log(`Found existing user ${user.id}`);
  }

  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, provider: "credential" },
  });
  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { password: hashed },
    });
    console.log("Updated credential password");
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
    console.log("Created credential account");
  }

  let org = await prisma.organization.findFirst({
    where: { name: orgName },
  });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: orgName,
        slug: `local-dev-org-${nanoid(6).toLowerCase()}`,
        license: LOCAL_DEV_ENTERPRISE_LICENSE_KEY,
      },
    });
    console.log(`Created organization ${org.id} (${org.slug})`);
  } else {
    console.log(`Found existing organization ${org.id} (${org.slug})`);
  }

  let team = await prisma.team.findFirst({
    where: { name: teamName, organizationId: org.id },
  });
  if (!team) {
    team = await prisma.team.create({
      data: {
        name: teamName,
        slug: `local-dev-team-${nanoid(6).toLowerCase()}`,
        organizationId: org.id,
      },
    });
    console.log(`Created team ${team.id} (${team.slug})`);
  } else {
    console.log(`Found existing team ${team.id} (${team.slug})`);
  }

  let project = await prisma.project.findFirst({
    where: { name: projectName, teamId: team.id },
  });
  if (!project) {
    const apiKey = `sk-lw-${nanoid(24)}`;
    project = await prisma.project.create({
      data: {
        id: nanoid(),
        name: projectName,
        slug: `local-dev-project-${nanoid(6).toLowerCase()}`,
        apiKey,
        teamId: team.id,
        language: "en",
        framework: "langchain",
        firstMessage: false,
        integrated: false,
        userLinkTemplate: null,
        piiRedactionLevel: "ESSENTIAL",
        capturedInputVisibility: "VISIBLE_TO_ALL",
        capturedOutputVisibility: "VISIBLE_TO_ALL",
      },
    });
    console.log(`Created project ${project.id} (${project.slug})`);
  } else {
    console.log(`Found existing project ${project.id} (${project.slug})`);
  }

  await prisma.organizationUser.upsert({
    where: {
      userId_organizationId: { userId: user.id, organizationId: org.id },
    },
    create: { userId: user.id, organizationId: org.id, role: "ADMIN" },
    update: { role: "ADMIN" },
  });
  await prisma.teamUser.upsert({
    where: { userId_teamId: { userId: user.id, teamId: team.id } },
    create: { userId: user.id, teamId: team.id, role: "ADMIN" },
    update: { role: "ADMIN" },
  });
  await prisma.roleBinding.deleteMany({
    where: { organizationId: org.id, userId: user.id },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: org.id,
    },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: team.id,
    },
  });
  console.log("Seeded org + team memberships and RoleBinding rows");

  console.log("\n=== LOGIN CREDENTIALS ===");
  console.log(`  URL:          http://localhost:5560/auth/signin`);
  console.log(`  Email:        ${email}`);
  console.log(`  Password:     ${password}`);
  console.log(`  Org slug:     ${org.slug}`);
  console.log(`  Team slug:    ${team.slug}`);
  console.log(`  Project slug: ${project.slug}`);
  console.log(`  API key:      ${project.apiKey}`);
  console.log("=========================");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
