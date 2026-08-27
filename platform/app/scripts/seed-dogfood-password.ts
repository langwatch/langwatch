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
 *   DOGFOOD_OWNER_EMAIL: copy this user's org+team membership (required, no fallback)
 *   DOGFOOD_USER_EMAIL:  login email (default dogfood@langwatch.local)
 *   DOGFOOD_PASSWORD:    login password (default DogfoodPassword!2026)
 *   DOGFOOD_USER_NAME:   display name (default Dogfood)
 */

import { hash } from "bcrypt";
import {
  RoleBindingScopeType,
  TeamUserRole,
  type User,
} from "@langwatch/prisma-client/generated";
import { prisma } from "../src/server/db";

type OwnerMemberships = {
  orgMemberships: { organizationId: string }[];
  teamMemberships: { teamId: string }[];
};

/** Find-or-create the login user and set its credential-provider password. */
async function upsertCredentialUser({
  email,
  name,
  password,
}: {
  email: string;
  name: string;
  password: string;
}): Promise<User> {
  const hashed = await hash(password, 10);
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name, emailVerified: true },
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
        // better-auth 1.7 keys an account by `(issuer, accountId)`; the local
        // credential provider's issuer is `local:credential`, not
        // `local:oauth:credential`. Without it sign-in cannot find this row.
        issuer: "local:credential",
        providerAccountId: user.id,
        type: "credentials",
        password: hashed,
      },
    });
    console.log("Created credential account");
  }
  return user;
}

/**
 * Mirror ALL of the owner's orgs + teams so the dogfood user reaches every
 * project they can see. Iterate the full graph: project URLs may redirect
 * across teams (landing on a project in team A while we joined only team B
 * makes tRPC 401 with "You do not have permission to access this project
 * resource"). OrganizationUser controls org-membership listing, TeamUser
 * the legacy team-membership listing.
 */
async function mirrorOwnerMembership({
  userId,
  owner,
}: {
  userId: string;
  owner: OwnerMemberships;
}): Promise<void> {
  for (const m of owner.orgMemberships) {
    await prisma.organizationUser.upsert({
      where: {
        userId_organizationId: { userId, organizationId: m.organizationId },
      },
      create: { userId, organizationId: m.organizationId, role: "ADMIN" },
      update: {},
    });
  }
  console.log(`Joined ${owner.orgMemberships.length} org(s)`);
  for (const m of owner.teamMemberships) {
    await prisma.teamUser.upsert({
      where: { userId_teamId: { userId, teamId: m.teamId } },
      create: { userId, teamId: m.teamId, role: "ADMIN" },
      update: {},
    });
  }
  console.log(`Joined ${owner.teamMemberships.length} team(s)`);
}

/**
 * Seed ORG + TEAM scoped RoleBinding rows. These drive RBAC checks like
 * getUserProtectionsForProject (api/utils.ts), which gates
 * canSeeCapturedOutput: without them Studio shows redacted node output even
 * when the project sets capturedOutputVisibility=VISIBLE_TO_ALL. RoleBinding
 * has no natural unique key Prisma knows about (partial indexes in
 * migrations enforce uniqueness), so deleteMany + create stays idempotent.
 */
async function seedRoleBindings({
  userId,
  owner,
}: {
  userId: string;
  owner: OwnerMemberships;
}): Promise<void> {
  // The multitenancy guard rejects a Team findMany without an
  // organizationId, even when the id filter is an empty list, so query per
  // org, the same reason the deleteMany below loops per org.
  const teamIds = owner.teamMemberships.map((m) => m.teamId);
  const teams: { id: string; organizationId: string }[] = [];
  for (const m of owner.orgMemberships) {
    const orgTeams = await prisma.team.findMany({
      where: { organizationId: m.organizationId, id: { in: teamIds } },
      select: { id: true, organizationId: true },
    });
    teams.push(...orgTeams);
  }
  for (const m of owner.orgMemberships) {
    await prisma.roleBinding.deleteMany({
      where: { userId, organizationId: m.organizationId },
    });
  }
  for (const m of owner.orgMemberships) {
    await prisma.roleBinding.create({
      data: {
        organizationId: m.organizationId,
        userId,
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
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: t.id,
      },
    });
  }
  console.log(
    `Seeded ${owner.orgMemberships.length} org + ${teams.length} team RoleBinding(s)`,
  );
}

async function main() {
  const ownerEmail = process.env.DOGFOOD_OWNER_EMAIL;
  if (!ownerEmail) {
    throw new Error(
      "DOGFOOD_OWNER_EMAIL is required. Set it to a user whose org/team membership the dogfood user should mirror.",
    );
  }
  const email = process.env.DOGFOOD_USER_EMAIL ?? "dogfood@langwatch.local";
  const password = process.env.DOGFOOD_PASSWORD ?? "DogfoodPassword!2026";
  const name = process.env.DOGFOOD_USER_NAME ?? "Dogfood";

  const user = await upsertCredentialUser({ email, name, password });

  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    include: { orgMemberships: true, teamMemberships: true },
  });
  if (!owner) {
    throw new Error(`Owner user not found: ${ownerEmail}`);
  }

  await mirrorOwnerMembership({ userId: user.id, owner });
  await seedRoleBindings({ userId: user.id, owner });

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
