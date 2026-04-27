/**
 * Seeds a credential-auth dev user that mirrors a real account's
 * org/team membership. Used by browser-QA dogfood: pnpm dev runs with
 * NEXTAUTH_PROVIDER=email, this user signs in with email+password,
 * inherits another user's project access without sharing credentials.
 *
 * Usage:
 *   DOGFOOD_OWNER_EMAIL=you@example.com npx tsx scripts/seed-dogfood-password.ts
 *
 * Env (all optional):
 *   DOGFOOD_OWNER_EMAIL — copy this user's org+team membership (default: required, no fallback)
 *   DOGFOOD_USER_EMAIL  — login email (default: dogfood@langwatch.local)
 *   DOGFOOD_PASSWORD    — login password (default: DogfoodPassword!2026)
 *   DOGFOOD_USER_NAME   — display name (default: Dogfood)
 */
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { hash } from "bcrypt";
import { prisma } from "../src/server/db";

async function main() {
  const ownerEmail = process.env.DOGFOOD_OWNER_EMAIL;
  if (!ownerEmail) {
    throw new Error(
      "DOGFOOD_OWNER_EMAIL is required — set it to a user whose org/team membership the dogfood user should mirror.",
    );
  }
  const email = process.env.DOGFOOD_USER_EMAIL ?? "dogfood@langwatch.local";
  const password = process.env.DOGFOOD_PASSWORD ?? "DogfoodPassword!2026";
  const name = process.env.DOGFOOD_USER_NAME ?? "Dogfood";
  const hashed = await hash(password, 10);

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name,
        emailVerified: true,
      },
    });
    console.log("Created user", user.id);
  }

  const acct = await prisma.account.findFirst({
    where: { userId: user.id, provider: "credential" },
  });
  if (acct) {
    await prisma.account.update({
      where: { id: acct.id },
      data: { password: hashed },
    });
    console.log("Updated credential account password");
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

  // Mirror ALL of the owner's orgs + teams so we have access to every
  // project they can see. Iterate the full graph: project URLs may redirect
  // across teams (e.g. landing on a project in team A while we'd only
  // joined team B → tRPC 401s with "You do not have permission to access
  // this project resource").
  //
  // Three tables to keep in lockstep, matching the canonical paths in
  // organization.prisma.repository.ts (org bootstrap) and team.ts (member
  // add):
  //   1. OrganizationUser  → controls org-membership listing
  //   2. TeamUser          → legacy team-membership listing
  //   3. RoleBinding       → drives RBAC checks like
  //      getUserProtectionsForProject (api/utils.ts:119) which gates
  //      canSeeCapturedOutput. Without ORG + TEAM scoped role bindings,
  //      Studio shows '🔒 Redacted' on every node output, even with the
  //      project's capturedOutputVisibility=VISIBLE_TO_ALL.
  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    include: { orgMemberships: true, teamMemberships: true },
  });
  if (!owner) {
    throw new Error(`Owner user not found: ${ownerEmail}`);
  }
  for (const m of owner.orgMemberships) {
    await prisma.organizationUser.upsert({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: m.organizationId,
        },
      },
      create: {
        userId: user.id,
        organizationId: m.organizationId,
        role: "ADMIN",
      },
      update: {},
    });
  }
  console.log(`Joined ${owner.orgMemberships.length} org(s)`);
  for (const m of owner.teamMemberships) {
    await prisma.teamUser.upsert({
      where: { userId_teamId: { userId: user.id, teamId: m.teamId } },
      create: {
        userId: user.id,
        teamId: m.teamId,
        role: "ADMIN",
      },
      update: {},
    });
  }
  console.log(`Joined ${owner.teamMemberships.length} team(s)`);

  // Seed RoleBinding rows. RoleBinding has no natural unique key Prisma
  // knows about (uniqueness is enforced via partial indexes in
  // migrations), so we deleteMany + create to stay idempotent.
  const teams = await prisma.team.findMany({
    where: { id: { in: owner.teamMemberships.map((m) => m.teamId) } },
    select: { id: true, organizationId: true },
  });
  await prisma.roleBinding.deleteMany({ where: { userId: user.id } });
  for (const m of owner.orgMemberships) {
    await prisma.roleBinding.create({
      data: {
        organizationId: m.organizationId,
        userId: user.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: m.organizationId,
      },
    });
  }
  for (const t of teams) {
    await prisma.roleBinding.create({
      data: {
        organizationId: t.organizationId,
        userId: user.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: t.id,
      },
    });
  }
  console.log(
    `Seeded ${owner.orgMemberships.length} org + ${teams.length} team RoleBinding(s)`,
  );

  console.log("\nSign in with:");
  console.log("  email:    ", email);
  console.log("  password: ", password);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
