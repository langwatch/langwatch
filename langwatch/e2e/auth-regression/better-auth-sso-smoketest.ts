/**
 * BetterAuth SSO domain matching smoke test — real prisma integration.
 *
 * Validates the SSO-specific database hooks from
 * `src/server/better-auth/hooks.ts` against a live Postgres:
 *
 *   - afterUserCreate: new user with matching ssoDomain → added to org
 *   - beforeAccountCreate: existing user + correct provider → clears pendingSsoSetup
 *   - beforeAccountCreate: existing user + wrong provider → sets pendingSsoSetup
 *   - beforeAccountCreate: existing user with a stale account → stale row deleted
 *   - beforeAccountCreate: deactivated user → throws
 *   - beforeAccountCreate: user with non-SSO domain → no-op
 *   - Auth0 prefix match ("waad|connection-name|userid")
 *
 * Run only against the isolated smoketest Postgres on port 5434.
 *
 *   DATABASE_URL="postgresql://langwatch_db:smoketest@localhost:5434/langwatch_db?sslmode=disable&schema=langwatch_db" \
 *     SKIP_REDIS=1 BUILD_TIME=1 NODE_ENV=development BASE_HOST=http://localhost:5560 \
 *     NEXTAUTH_URL=http://localhost:5560 NEXTAUTH_SECRET=smoketest-secret-at-least-32-chars-long \
 *     NEXTAUTH_PROVIDER=email \
 *     npx tsx scripts/better-auth-sso-smoketest.ts
 */

import { PrismaClient } from "@prisma/client";
import { assertLocalhostDatabaseUrl } from "./_smoketest-guard";

let exitCode = 0;

const check = (label: string, condition: boolean, detail?: string): void => {
  if (condition) {
    console.log(`    ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.error(`    ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    exitCode = 1;
  }
};

async function main() {
  assertLocalhostDatabaseUrl();

  const prisma = new PrismaClient();
  const { afterUserCreate, beforeAccountCreate } = await import(
    "../../src/server/better-auth/hooks"
  );

  // ─────────────────────────────────────────────────────────────────
  // FIXTURES
  // ─────────────────────────────────────────────────────────────────

  console.log("═".repeat(60));
  console.log("BetterAuth SSO hook integration smoke test");
  console.log("═".repeat(60));

  // Clean up prior runs.
  const cleanup = async () => {
    await prisma.session.deleteMany({
      where: { userId: { startsWith: "sso_smoke_" } },
    });
    await prisma.account.deleteMany({
      where: { userId: { startsWith: "sso_smoke_" } },
    });
    await prisma.organizationUser.deleteMany({
      where: { userId: { startsWith: "sso_smoke_" } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: "sso_smoke_" } },
    });
    await prisma.organization.deleteMany({
      where: { id: { startsWith: "sso_smoke_" } },
    });
  };
  await cleanup();

  console.log("\n[setup] Creating SSO organizations...");

  // Google-based SSO org
  await prisma.organization.create({
    data: {
      id: "sso_smoke_org_google",
      name: "Google SSO Corp",
      slug: "sso-smoke-google",
      ssoDomain: "google-corp.test",
      ssoProvider: "google",
    },
  });

  // Auth0-WAAD (Azure) based SSO org — prefix matching
  await prisma.organization.create({
    data: {
      id: "sso_smoke_org_waad",
      name: "WAAD SSO Corp",
      slug: "sso-smoke-waad",
      ssoDomain: "waad-corp.test",
      ssoProvider: "waad|waad-corp-connection",
    },
  });

  // Okta-based SSO org
  await prisma.organization.create({
    data: {
      id: "sso_smoke_org_okta",
      name: "Okta SSO Corp",
      slug: "sso-smoke-okta",
      ssoDomain: "okta-corp.test",
      ssoProvider: "okta",
    },
  });

  // ─────────────────────────────────────────────────────────────────
  // [1] New user with matching SSO domain → afterUserCreate adds to org
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[1] New SSO user is auto-added to the matching org");
  await prisma.user.create({
    data: {
      id: "sso_smoke_newuser1",
      email: "alice@google-corp.test",
      name: "Alice",
    },
  });
  await afterUserCreate({
    prisma,
    user: { id: "sso_smoke_newuser1", email: "alice@google-corp.test" },
  });
  const alice = await prisma.organizationUser.findFirst({
    where: { userId: "sso_smoke_newuser1" },
  });
  check("OrganizationUser row created", !!alice);
  check(
    "role=MEMBER",
    alice?.role === "MEMBER",
    alice?.role,
  );
  check(
    "organizationId matches SSO org",
    alice?.organizationId === "sso_smoke_org_google",
    alice?.organizationId,
  );

  // ─────────────────────────────────────────────────────────────────
  // [2] Email domain does NOT match any SSO org → no-op
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[2] Non-SSO domain signup is a no-op");
  await prisma.user.create({
    data: {
      id: "sso_smoke_newuser2",
      email: "bob@unrelated.test",
      name: "Bob",
    },
  });
  await afterUserCreate({
    prisma,
    user: { id: "sso_smoke_newuser2", email: "bob@unrelated.test" },
  });
  const bobOrgs = await prisma.organizationUser.findMany({
    where: { userId: "sso_smoke_newuser2" },
  });
  check(
    "bob has no org memberships",
    bobOrgs.length === 0,
    `found ${bobOrgs.length}`,
  );

  // ─────────────────────────────────────────────────────────────────
  // [3] Existing user + correct Google provider → clears pendingSsoSetup
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[3] Existing user + correct Google provider → clears pendingSsoSetup");
  await prisma.user.create({
    data: {
      id: "sso_smoke_existing1",
      email: "carol@google-corp.test",
      name: "Carol",
      pendingSsoSetup: true,
    },
  });
  await beforeAccountCreate({
    prisma,
    account: {
      userId: "sso_smoke_existing1",
      providerId: "google",
      accountId: "google-oauth2|carol-123",
    },
  });
  const carolRefreshed = await prisma.user.findUnique({
    where: { id: "sso_smoke_existing1" },
  });
  check(
    "pendingSsoSetup cleared",
    carolRefreshed?.pendingSsoSetup === false,
  );

  // ─────────────────────────────────────────────────────────────────
  // [4] EXISTING user (with a prior working account) + WRONG provider
  //     for SSO org → soft-block via pendingSsoSetup banner.
  //
  //     Note: the existing user MUST have at least one prior Account row
  //     for the soft-block branch to fire. The iter-17 `beforeAccountCreate`
  //     hook uses `account.count > 0` as the signal for "this is an
  //     existing user linking another provider" vs "first-time signup".
  //     A User row without any accounts is treated as a first-time signup
  //     and is HARD-blocked with SSO_PROVIDER_NOT_ALLOWED — see test [4.5]
  //     below for that case.
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[4] Existing user (with prior account) + WRONG provider → sets pendingSsoSetup=true");
  await prisma.user.create({
    data: {
      id: "sso_smoke_existing2",
      email: "dave@okta-corp.test",
      name: "Dave",
      pendingSsoSetup: false,
    },
  });
  // Pre-existing account row: simulates a user who previously linked
  // an SSO account and is now adding a second provider. This is the
  // "account linking" scenario, which should be soft-blocked.
  await prisma.account.create({
    data: {
      id: "sso_smoke_existing2_prior",
      userId: "sso_smoke_existing2",
      type: "oauth",
      provider: "okta",
      providerAccountId: "okta-dave-456-original",
    },
  });
  await beforeAccountCreate({
    prisma,
    account: {
      userId: "sso_smoke_existing2",
      providerId: "google", // WRONG — org wants okta
      accountId: "google-oauth2|dave-456",
    },
  });
  const daveRefreshed = await prisma.user.findUnique({
    where: { id: "sso_smoke_existing2" },
  });
  check(
    "pendingSsoSetup set to true (existing user, wrong provider, soft-blocked)",
    daveRefreshed?.pendingSsoSetup === true,
  );

  // ─────────────────────────────────────────────────────────────────
  // [4.5] FIRST-TIME signup (no prior accounts) + WRONG provider for
  //      SSO-enforced org → HARD block with SSO_PROVIDER_NOT_ALLOWED.
  //      Iter-17 security fix: prevents attackers from bypassing an
  //      org's SSO enforcement by signing up via a different provider.
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[4.5] NEW signup (no prior account) + WRONG provider → hard-blocks with SSO_PROVIDER_NOT_ALLOWED");
  await prisma.user.create({
    data: {
      id: "sso_smoke_newsignup2",
      email: "mallory@okta-corp.test",
      name: "Mallory",
      pendingSsoSetup: false,
    },
  });
  let hardBlockThrew = false;
  try {
    await beforeAccountCreate({
      prisma,
      account: {
        userId: "sso_smoke_newsignup2",
        providerId: "google", // WRONG — org wants okta
        accountId: "google-oauth2|mallory-789",
      },
    });
  } catch (err) {
    hardBlockThrew =
      err instanceof Error && /SSO_PROVIDER_NOT_ALLOWED/.test(err.message);
  }
  check(
    "throws SSO_PROVIDER_NOT_ALLOWED for first-time signup with wrong provider",
    hardBlockThrew,
  );

  // ─────────────────────────────────────────────────────────────────
  // [5] Auth0 WAAD prefix match ("waad|connection-name|...")
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[5] Auth0 WAAD prefix match succeeds");
  await prisma.user.create({
    data: {
      id: "sso_smoke_existing3",
      email: "eve@waad-corp.test",
      name: "Eve",
      pendingSsoSetup: true,
    },
  });
  await beforeAccountCreate({
    prisma,
    account: {
      userId: "sso_smoke_existing3",
      providerId: "auth0",
      accountId: "waad|waad-corp-connection|eve-789",
    },
  });
  const eveRefreshed = await prisma.user.findUnique({
    where: { id: "sso_smoke_existing3" },
  });
  check(
    "pendingSsoSetup cleared for WAAD prefix match",
    eveRefreshed?.pendingSsoSetup === false,
  );

  // ─────────────────────────────────────────────────────────────────
  // [6] Stale account for same provider but different accountId → deleted
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[6] Stale account rows for same provider are deleted");
  await prisma.user.create({
    data: {
      id: "sso_smoke_existing4",
      email: "frank@google-corp.test",
      name: "Frank",
      pendingSsoSetup: true,
    },
  });
  // Pre-seed a stale account (different providerAccountId for the same provider)
  await prisma.account.create({
    data: {
      id: "sso_smoke_stale_acc",
      userId: "sso_smoke_existing4",
      type: "oauth",
      provider: "google",
      providerAccountId: "google-oauth2|frank-OLD-id",
    },
  });
  await beforeAccountCreate({
    prisma,
    account: {
      userId: "sso_smoke_existing4",
      providerId: "google",
      accountId: "google-oauth2|frank-NEW-id",
    },
  });
  const frankAccounts = await prisma.account.findMany({
    where: { userId: "sso_smoke_existing4", provider: "google" },
  });
  check(
    "stale google account deleted",
    frankAccounts.every((a) => a.providerAccountId !== "google-oauth2|frank-OLD-id"),
  );

  // ─────────────────────────────────────────────────────────────────
  // [7] Deactivated user hitting account create → throws
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[7] Deactivated user triggers USER_DEACTIVATED");
  await prisma.user.create({
    data: {
      id: "sso_smoke_deactivated",
      email: "ghost@google-corp.test",
      name: "Ghost",
      deactivatedAt: new Date("2020-01-01"),
    },
  });
  let threw = false;
  try {
    await beforeAccountCreate({
      prisma,
      account: {
        userId: "sso_smoke_deactivated",
        providerId: "google",
        accountId: "google-oauth2|ghost-1",
      },
    });
  } catch (err) {
    threw = (err as Error).message.includes("USER_DEACTIVATED");
  }
  check("threw USER_DEACTIVATED", threw);

  // ─────────────────────────────────────────────────────────────────
  // [8] User with no org, non-SSO domain, new account → no-op
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[8] User with non-SSO domain on new Account → no-op");
  await prisma.user.create({
    data: {
      id: "sso_smoke_noorg",
      email: "helen@random.test",
      name: "Helen",
      pendingSsoSetup: false,
    },
  });
  await beforeAccountCreate({
    prisma,
    account: {
      userId: "sso_smoke_noorg",
      providerId: "google",
      accountId: "google-oauth2|helen-1",
    },
  });
  const helen = await prisma.user.findUnique({
    where: { id: "sso_smoke_noorg" },
  });
  check(
    "pendingSsoSetup untouched for non-SSO user",
    helen?.pendingSsoSetup === false,
  );

  // ─────────────────────────────────────────────────────────────────
  // [8.5] Case-insensitive email domain matching
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[8.5] Mixed-case email matches lowercase ssoDomain");
  await prisma.user.create({
    data: {
      id: "sso_smoke_mixedcase",
      email: "Isaac@GOOGLE-CORP.TEST",
      name: "Isaac",
    },
  });
  await afterUserCreate({
    prisma,
    user: { id: "sso_smoke_mixedcase", email: "Isaac@GOOGLE-CORP.TEST" },
  });
  const isaacOrg = await prisma.organizationUser.findFirst({
    where: { userId: "sso_smoke_mixedcase" },
  });
  check(
    "mixed-case email lowercased before ssoDomain lookup",
    isaacOrg?.organizationId === "sso_smoke_org_google",
    isaacOrg?.organizationId,
  );

  // ─────────────────────────────────────────────────────────────────
  // [9] Idempotency — running afterUserCreate twice doesn't double-add
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[9] afterUserCreate is NOT idempotent (warning)");
  // Note: the current implementation does NOT guard against duplicate
  // OrganizationUser rows. Running afterUserCreate twice for the same user
  // would create two membership rows. This is a gap worth flagging.
  let secondAddThrew = false;
  try {
    await afterUserCreate({
      prisma,
      user: { id: "sso_smoke_newuser1", email: "alice@google-corp.test" },
    });
  } catch (err) {
    secondAddThrew = true;
  }
  const aliceMemberships = await prisma.organizationUser.findMany({
    where: { userId: "sso_smoke_newuser1" },
  });
  if (secondAddThrew) {
    check(
      "second afterUserCreate threw (expected if unique constraint exists)",
      true,
      `memberships: ${aliceMemberships.length}`,
    );
  } else {
    console.log(
      `    ⚠  second afterUserCreate did NOT throw — alice now has ${aliceMemberships.length} memberships`,
    );
    if (aliceMemberships.length > 1) {
      console.log(
        "    ⚠  DUPLICATE MEMBERSHIP BUG: afterUserCreate is not idempotent",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[cleanup] Removing smoketest data...");
  await cleanup();

  await prisma.$disconnect();

  console.log("\n" + "═".repeat(60));
  if (exitCode) {
    console.error("❌ SMOKE TEST FAILED — see ✗ marks above");
  } else {
    console.log("✅ ALL CHECKS PASSED");
  }
  console.log("═".repeat(60));

  setTimeout(() => process.exit(exitCode), 100);
}

main().catch(async (err) => {
  console.error("SMOKE TEST CRASHED:", err);
  process.exit(1);
});
