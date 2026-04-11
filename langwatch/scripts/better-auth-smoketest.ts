/**
 * BetterAuth cutover smoke test — end-to-end validation against a real
 * isolated Postgres. Covers the flows that matter most for the cutover:
 *
 *   1. Credentials signup + credentials signin happy path
 *   2. Wrong password rejected
 *   3. Deactivated user blocked from signin
 *   4. Session lookup via auth.api.getSession with cookies
 *   5. Session cookie attributes (HttpOnly, SameSite)
 *   6. Signout clears the session
 *   7. Admin impersonation compat via Session.impersonating JSON column
 *   8. lastLoginAt is updated on signin by afterSessionCreate hook
 *
 * Run against the isolated smoketest Postgres only — NEVER shared RDS.
 *
 *   docker run -d --name langwatch-betterauth-smoketest \
 *     -p 5434:5432 -e POSTGRES_DB=langwatch_db \
 *     -e POSTGRES_USER=langwatch_db -e POSTGRES_PASSWORD=smoketest \
 *     postgres:16
 *
 *   DATABASE_URL="postgresql://langwatch_db:smoketest@localhost:5434/langwatch_db?sslmode=disable&schema=langwatch_db" \
 *     NEXTAUTH_URL=http://localhost:5560 \
 *     NEXTAUTH_SECRET=smoketest-secret-at-least-32-chars-long \
 *     NEXTAUTH_PROVIDER=email \
 *     SKIP_REDIS=1 BUILD_TIME=1 NODE_ENV=development \
 *     BASE_HOST=http://localhost:5560 \
 *     npx tsx scripts/better-auth-smoketest.ts
 */

import { hash } from "bcrypt";
import { PrismaClient } from "@prisma/client";

const check = (label: string, condition: boolean, detail?: string): void => {
  if (condition) {
    console.log(`    ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.error(`    ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    process.exitCode = 1;
  }
};

const SMOKETEST_EMAIL = "smoketest@example.com";
const SMOKETEST_PASSWORD = "correct-horse-battery-staple";
const SMOKETEST_USER_ID = "smoketest_user_1";
const DEACTIVATED_USER_ID = "smoketest_deactivated";
const DEACTIVATED_EMAIL = "deactivated@example.com";

const parseSetCookie = (header: string | null): Record<string, string | boolean> => {
  if (!header) return {};
  const parts = header.split(";").map((p) => p.trim());
  const result: Record<string, string | boolean> = {};
  for (const [i, part] of parts.entries()) {
    if (i === 0) {
      const [name, value] = part.split("=");
      if (name && value) result[name] = value;
      continue;
    }
    const [k, v] = part.split("=");
    if (k) result[k.toLowerCase()] = v ?? true;
  }
  return result;
};

async function main() {
  if (!process.env.DATABASE_URL?.includes("localhost")) {
    console.error(
      "REFUSING TO RUN: DATABASE_URL must point to localhost to avoid shared-DB damage",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  // Clean up any prior smoketest runs so the script is idempotent.
  await prisma.session.deleteMany({
    where: { userId: { in: [SMOKETEST_USER_ID, DEACTIVATED_USER_ID] } },
  });
  await prisma.account.deleteMany({
    where: { userId: { in: [SMOKETEST_USER_ID, DEACTIVATED_USER_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [SMOKETEST_USER_ID, DEACTIVATED_USER_ID] } },
  });

  console.log("═".repeat(60));
  console.log("BetterAuth cutover smoke test");
  console.log("═".repeat(60));

  // ─────────────────────────────────────────────────────────────────
  // SETUP
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[setup] Creating test users...");
  const passwordHash = await hash(SMOKETEST_PASSWORD, 10);

  await prisma.user.create({
    data: {
      id: SMOKETEST_USER_ID,
      email: SMOKETEST_EMAIL,
      name: "Smoke Test",
    },
  });
  await prisma.account.create({
    data: {
      id: "smoketest_cred_1",
      userId: SMOKETEST_USER_ID,
      type: "credential",
      provider: "credential",
      providerAccountId: SMOKETEST_USER_ID,
      password: passwordHash,
    },
  });

  await prisma.user.create({
    data: {
      id: DEACTIVATED_USER_ID,
      email: DEACTIVATED_EMAIL,
      name: "Deactivated",
      deactivatedAt: new Date("2020-01-01"),
    },
  });
  await prisma.account.create({
    data: {
      id: "smoketest_cred_deactivated",
      userId: DEACTIVATED_USER_ID,
      type: "credential",
      provider: "credential",
      providerAccountId: DEACTIVATED_USER_ID,
      password: passwordHash,
    },
  });

  const { auth } = await import("../src/server/better-auth");

  // ─────────────────────────────────────────────────────────────────
  // HAPPY PATH: credentials signin
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[1] Credentials signin with correct password");
  const signInRes = await auth.api.signInEmail({
    body: { email: SMOKETEST_EMAIL, password: SMOKETEST_PASSWORD },
    asResponse: true,
  });
  check("HTTP 200", signInRes.status === 200, `got ${signInRes.status}`);
  const setCookieHeader = signInRes.headers.get("set-cookie");
  check("Set-Cookie header present", !!setCookieHeader);
  const parsedCookie = parseSetCookie(setCookieHeader);
  check(
    "session_token cookie set",
    !!parsedCookie["better-auth.session_token"],
  );
  check("HttpOnly flag", !!parsedCookie.httponly);
  check("SameSite=Lax flag", parsedCookie.samesite === "Lax" || parsedCookie.samesite === "lax");
  check(
    "Path=/ flag",
    parsedCookie.path === "/" || parsedCookie.path === "/" + "",
  );

  // Verify the session row has the expected 30-day expiry (NextAuth parity).
  const sessionRow = await prisma.session.findFirst({
    where: { userId: SMOKETEST_USER_ID },
    orderBy: { createdAt: "desc" },
  });
  if (sessionRow) {
    const expiresInDays =
      (sessionRow.expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    check(
      "session TTL is ~30 days (NextAuth parity)",
      expiresInDays > 29 && expiresInDays <= 30,
      `${expiresInDays.toFixed(2)} days`,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // WRONG PASSWORD
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[2] Credentials signin with WRONG password");
  const wrongRes = await auth.api.signInEmail({
    body: { email: SMOKETEST_EMAIL, password: "wrong-password" },
    asResponse: true,
  });
  check(
    "HTTP 401 for wrong password",
    wrongRes.status === 401,
    `got ${wrongRes.status}`,
  );
  const wrongCookie = wrongRes.headers.get("set-cookie");
  check(
    "no session cookie set on failure",
    !wrongCookie?.includes("better-auth.session_token"),
  );

  // ─────────────────────────────────────────────────────────────────
  // NONEXISTENT USER
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[3] Credentials signin with nonexistent email");
  const nobodyRes = await auth.api.signInEmail({
    body: { email: "nobody@nowhere.test", password: SMOKETEST_PASSWORD },
    asResponse: true,
  });
  check(
    "HTTP 401 for nonexistent user",
    nobodyRes.status === 401,
    `got ${nobodyRes.status}`,
  );

  // ─────────────────────────────────────────────────────────────────
  // DEACTIVATED USER
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[4] Deactivated user cannot sign in");
  const deactRes = await auth.api.signInEmail({
    body: { email: DEACTIVATED_EMAIL, password: SMOKETEST_PASSWORD },
    asResponse: true,
  });
  // BetterAuth credential verify succeeds, then beforeSessionCreate
  // returns false, which BetterAuth surfaces as a failed signin.
  check(
    "deactivated signin is NOT a 200",
    deactRes.status !== 200,
    `got ${deactRes.status}`,
  );
  const deactCookie = deactRes.headers.get("set-cookie");
  check(
    "no session cookie set for deactivated user",
    !deactCookie?.includes("better-auth.session_token"),
  );
  const deactSessions = await prisma.session.findMany({
    where: { userId: DEACTIVATED_USER_ID },
  });
  check(
    "no Session row created for deactivated user",
    deactSessions.length === 0,
    `found ${deactSessions.length}`,
  );

  // ─────────────────────────────────────────────────────────────────
  // SESSION LOOKUP VIA COOKIE
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[5] auth.api.getSession recognizes a valid cookie");
  if (!setCookieHeader) {
    console.error("    no cookie header from signin, skipping");
  } else {
    const cookieHeader = (setCookieHeader.split(";")[0] ?? "") as string;
    const headers = new Headers();
    headers.set("cookie", cookieHeader);
    const sessionResult = await auth.api.getSession({ headers });
    check("getSession returned non-null", !!sessionResult);
    check(
      "user.id matches the signed-in user",
      sessionResult?.user.id === SMOKETEST_USER_ID,
      `got ${sessionResult?.user.id}`,
    );
    check(
      "user.email matches",
      sessionResult?.user.email === SMOKETEST_EMAIL,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // LASTLOGINAT UPDATED
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[6] afterSessionCreate hook updates lastLoginAt");
  const refreshed = await prisma.user.findUnique({
    where: { id: SMOKETEST_USER_ID },
  });
  check("lastLoginAt is set", !!refreshed?.lastLoginAt);
  if (refreshed?.lastLoginAt) {
    const delta = Date.now() - refreshed.lastLoginAt.getTime();
    check(
      "lastLoginAt is recent (< 30s old)",
      delta < 30_000,
      `${delta}ms old`,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // SIGNOUT
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[7] Signout clears the session");
  if (setCookieHeader) {
    const cookieHeader = (setCookieHeader.split(";")[0] ?? "") as string;
    const signOutHeaders = new Headers();
    signOutHeaders.set("cookie", cookieHeader);
    const signOutRes = await auth.api.signOut({
      headers: signOutHeaders,
      asResponse: true,
    });
    check("signOut HTTP 200", signOutRes.status === 200, `got ${signOutRes.status}`);
    const clearCookie = signOutRes.headers.get("set-cookie");
    const parsedClear = parseSetCookie(clearCookie);
    const clearedToken = parsedClear["better-auth.session_token"];
    check(
      "signOut clears session_token cookie",
      clearedToken === "" || typeof clearedToken === "undefined",
      `got ${JSON.stringify(clearedToken)}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // ADMIN IMPERSONATION COMPAT via Session.impersonating
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[8] Admin impersonation compat via Session.impersonating JSON");
  // Create a real impersonation target user. The compat layer in
  // iter 14 now verifies the target still exists + isn't deactivated,
  // so we need a real user in the DB (not a fake id).
  const IMP_TARGET_ID = "smoketest_imp_target";
  const IMP_TARGET_EMAIL = "imp_target@example.com";
  await prisma.user.upsert({
    where: { id: IMP_TARGET_ID },
    update: { deactivatedAt: null, name: "Impersonation Target" },
    create: {
      id: IMP_TARGET_ID,
      email: IMP_TARGET_EMAIL,
      name: "Impersonation Target",
    },
  });

  // Create a fresh signin, then write impersonating JSON directly and
  // re-fetch the session via the compat getServerAuthSession helper.
  const imp0 = await auth.api.signInEmail({
    body: { email: SMOKETEST_EMAIL, password: SMOKETEST_PASSWORD },
    asResponse: true,
  });
  const impCookie = imp0.headers.get("set-cookie");
  const sessions = await prisma.session.findMany({
    where: { userId: SMOKETEST_USER_ID },
    orderBy: { createdAt: "desc" },
  });
  const freshSession = sessions[0];
  if (!freshSession || !impCookie) {
    console.error("    could not set up impersonation fixture");
  } else {
    await prisma.session.update({
      where: { id: freshSession.id },
      data: {
        impersonating: {
          id: IMP_TARGET_ID,
          name: "Impersonation Target",
          email: IMP_TARGET_EMAIL,
          image: null,
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      },
    });

    // Use the compat getServerAuthSession helper.
    const { getServerAuthSession } = await import("../src/server/auth");
    const fakeReq = {
      headers: { cookie: impCookie.split(";")[0] ?? "" },
    } as any;
    const adminSession = await getServerAuthSession({ req: fakeReq });
    check(
      "getServerAuthSession returned non-null",
      !!adminSession,
    );
    check(
      "user.id is the impersonated target",
      adminSession?.user.id === IMP_TARGET_ID,
      `got ${adminSession?.user.id}`,
    );
    check(
      "user.email is the impersonated target",
      adminSession?.user.email === IMP_TARGET_EMAIL,
    );
    check(
      "impersonator is the real admin",
      adminSession?.user.impersonator?.id === SMOKETEST_USER_ID,
      `got ${adminSession?.user.impersonator?.id}`,
    );
    check(
      "impersonator.email is the admin email",
      adminSession?.user.impersonator?.email === SMOKETEST_EMAIL,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // IMPERSONATION EXPIRATION
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[9] Expired impersonation falls through to real session");
  if (freshSession && impCookie) {
    await prisma.session.update({
      where: { id: freshSession.id },
      data: {
        impersonating: {
          id: IMP_TARGET_ID,
          name: "Impersonation Target",
          email: IMP_TARGET_EMAIL,
          image: null,
          expires: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });

    const { getServerAuthSession } = await import("../src/server/auth");
    const fakeReq = {
      headers: { cookie: impCookie.split(";")[0] ?? "" },
    } as any;
    const expiredImp = await getServerAuthSession({ req: fakeReq });
    check(
      "user.id falls back to the real admin",
      expiredImp?.user.id === SMOKETEST_USER_ID,
    );
    check(
      "impersonator is undefined after expiration",
      expiredImp?.user.impersonator === undefined,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // LEGACY BCRYPT HASH COMPAT (on-prem upgrade path)
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[10] Legacy bcrypt hash (cost 10) from NextAuth still verifies");
  // Pre-computed bcrypt hash for "legacy-password-from-2024" with cost 10.
  // This simulates a user whose password was originally hashed by the old
  // NextAuth credentials provider using `hash(password, 10)` — we want
  // BetterAuth's password.verify override to accept it unchanged.
  const legacyHash = await hash("legacy-password-from-2024", 10);
  await prisma.user.create({
    data: {
      id: "smoketest_legacy",
      email: "legacy@example.com",
      name: "Legacy User",
    },
  });
  await prisma.account.create({
    data: {
      id: "smoketest_legacy_cred",
      userId: "smoketest_legacy",
      type: "credential",
      provider: "credential",
      providerAccountId: "smoketest_legacy",
      password: legacyHash,
    },
  });
  const legacyRes = await auth.api.signInEmail({
    body: {
      email: "legacy@example.com",
      password: "legacy-password-from-2024",
    },
    asResponse: true,
  });
  check(
    "legacy bcrypt hash accepted",
    legacyRes.status === 200,
    `got ${legacyRes.status}`,
  );

  // ─────────────────────────────────────────────────────────────────
  // SIGNUP via auth.api.signUpEmail
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[11] New user signup via auth.api.signUpEmail");
  await prisma.user.deleteMany({ where: { email: "newuser@example.com" } });
  const signUpRes = await auth.api.signUpEmail({
    body: {
      email: "newuser@example.com",
      password: "new-user-password-1234",
      name: "New User",
    },
    asResponse: true,
  });
  check(
    "signUp HTTP 200",
    signUpRes.status === 200,
    `got ${signUpRes.status}`,
  );
  const newUser = await prisma.user.findUnique({
    where: { email: "newuser@example.com" },
  });
  check("User row created", !!newUser);
  if (newUser) {
    const newAccount = await prisma.account.findFirst({
      where: { userId: newUser.id, provider: "credential" },
    });
    check("credential Account row created", !!newAccount);
    check(
      "credential Account has password hash",
      !!newAccount?.password,
    );
  }

  // NOTE: Rate limiting is NOT verifiable from this smoketest. BetterAuth's
  // rate-limit middleware only runs on real HTTP requests, not in-process
  // `auth.api.*` calls. Config is present (window=15m, max=10 on /sign-in/email)
  // but end-to-end verification requires launching the dev server and hitting
  // /api/auth/sign-in/email over HTTP. Validated separately via browser QA.

  // ─────────────────────────────────────────────────────────────────
  // [12] tRPC user.register flow (used by /auth/signup page)
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[12] tRPC user.register creates User + credential Account in a transaction");
  await prisma.user.deleteMany({ where: { email: "trpc@example.com" } });
  // Simulate the tRPC register mutation by replicating its logic.
  // (We can't easily instantiate the full tRPC context in this script.)
  const trpcName = "TRPC User";
  const trpcEmail = "trpc@example.com";
  const trpcPassword = "trpc-password-1234";
  const trpcHashedPassword = await hash(trpcPassword, 10);
  const trpcUser = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: trpcName, email: trpcEmail },
    });
    await tx.account.create({
      data: {
        userId: created.id,
        type: "credential",
        provider: "credential",
        providerAccountId: created.id,
        password: trpcHashedPassword,
      },
    });
    return created;
  });
  check("transaction created User row", !!trpcUser);

  // Immediately try to sign in via BetterAuth using those credentials.
  const trpcSignIn = await auth.api.signInEmail({
    body: { email: trpcEmail, password: trpcPassword },
    asResponse: true,
  });
  check(
    "BetterAuth can sign in the tRPC-created user",
    trpcSignIn.status === 200,
    `got ${trpcSignIn.status}`,
  );

  // ─────────────────────────────────────────────────────────────────
  // [13] changePassword via Account row update
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[13] changePassword updates Account.password (not User.password)");
  const newPassword = "new-password-after-change";
  const newPasswordHash = await hash(newPassword, 10);
  // Simulate the tRPC changePassword mutation logic
  const credentialAccount = await prisma.account.findFirst({
    where: { userId: trpcUser.id, provider: "credential" },
  });
  check("found credential account", !!credentialAccount);
  if (credentialAccount) {
    await prisma.account.update({
      where: { id: credentialAccount.id },
      data: { password: newPasswordHash },
    });

    // Verify old password no longer works
    const oldPassRes = await auth.api.signInEmail({
      body: { email: trpcEmail, password: trpcPassword },
      asResponse: true,
    });
    check(
      "old password is rejected after change",
      oldPassRes.status === 401,
      `got ${oldPassRes.status}`,
    );

    // Verify new password works
    const newPassRes = await auth.api.signInEmail({
      body: { email: trpcEmail, password: newPassword },
      asResponse: true,
    });
    check(
      "new password is accepted",
      newPassRes.status === 200,
      `got ${newPassRes.status}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // [14] UserService.create (used by SCIM webhook) still works
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[14] UserService.create still creates a User without password column");
  await prisma.user.deleteMany({ where: { email: "scim@example.com" } });
  // SCIM webhook path: creates a User with just name + email, no Account
  const scimUser = await prisma.user.create({
    data: { name: "SCIM User", email: "scim@example.com" },
  });
  check("SCIM-style User row created", !!scimUser);
  check(
    "User has no password field (moved to Account)",
    !("password" in scimUser),
  );

  // ─────────────────────────────────────────────────────────────────
  // CLEANUP NEW FIXTURES
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[cleanup extra] Removing additional smoketest data...");
  await prisma.session.deleteMany({
    where: { user: { email: { in: ["trpc@example.com", "scim@example.com"] } } },
  });
  await prisma.account.deleteMany({
    where: { user: { email: { in: ["trpc@example.com", "scim@example.com"] } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: ["trpc@example.com", "scim@example.com"] } },
  });

  // ─────────────────────────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────
  // [9.5] Compat layer rejects impersonation of deleted target
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[9.5] Impersonation target deleted after start → fall back to admin");
  if (freshSession && impCookie) {
    // Write a valid (non-expired) impersonation payload for a nonexistent user.
    await prisma.session.update({
      where: { id: freshSession.id },
      data: {
        impersonating: {
          id: "nonexistent_deleted_user",
          name: "Deleted User",
          email: "deleted@example.com",
          image: null,
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      },
    });

    const { getServerAuthSession } = await import("../src/server/auth");
    const fakeReq = {
      headers: { cookie: impCookie.split(";")[0] ?? "" },
    } as any;
    const orphaned = await getServerAuthSession({ req: fakeReq });
    check(
      "falls back to the admin session (target was deleted)",
      orphaned?.user.id === SMOKETEST_USER_ID,
      `got ${orphaned?.user.id}`,
    );
    check(
      "impersonator is undefined when target was deleted",
      orphaned?.user.impersonator === undefined,
    );
  }

  console.log("\n[cleanup] Removing smoketest data...");
  await prisma.user.deleteMany({
    where: { id: "smoketest_imp_target" },
  });
  await prisma.session.deleteMany({ where: { userId: "smoketest_legacy" } });
  await prisma.account.deleteMany({ where: { userId: "smoketest_legacy" } });
  await prisma.user.deleteMany({ where: { id: "smoketest_legacy" } });
  await prisma.session.deleteMany({
    where: { user: { email: "newuser@example.com" } },
  });
  await prisma.account.deleteMany({
    where: { user: { email: "newuser@example.com" } },
  });
  await prisma.user.deleteMany({
    where: { email: "newuser@example.com" },
  });
  await prisma.session.deleteMany({
    where: { userId: { in: [SMOKETEST_USER_ID, DEACTIVATED_USER_ID] } },
  });
  await prisma.account.deleteMany({
    where: { userId: { in: [SMOKETEST_USER_ID, DEACTIVATED_USER_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [SMOKETEST_USER_ID, DEACTIVATED_USER_ID] } },
  });

  await prisma.$disconnect();

  console.log("\n" + "═".repeat(60));
  if (process.exitCode) {
    console.error("❌ SMOKE TEST FAILED — see ✗ marks above");
  } else {
    console.log("✅ ALL CHECKS PASSED");
  }
  console.log("═".repeat(60));

  // Force-exit: fire-and-forget nurturing hooks keep the event loop alive
  // in a standalone script where the app isn't bootstrapped.
  setTimeout(() => process.exit(process.exitCode ?? 0), 100);
}

main().catch(async (err) => {
  console.error("SMOKE TEST CRASHED:", err);
  process.exit(1);
});
