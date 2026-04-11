/**
 * Compat layer smoke test — validates `src/server/auth.ts`'s
 * `getServerAuthSession` against REAL Postgres + REAL session cookies
 * generated via BetterAuth's signInEmail. This is the thing that every
 * tRPC endpoint + API route calls for auth, so it's the most
 * consumer-facing surface of the whole migration.
 *
 * Unit tests for this already exist (src/server/__tests__/) but they
 * mock `auth.api.getSession`. This script goes end-to-end: real cookie
 * from a real signin, parsed by real BetterAuth, adapted by the real
 * compat layer.
 *
 * Run against the isolated smoketest Postgres only.
 */

import { hash } from "bcrypt";
import { PrismaClient } from "@prisma/client";

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
  if (!process.env.DATABASE_URL?.includes("localhost")) {
    console.error("REFUSING: DATABASE_URL must point to localhost");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const userId = "compat_smoke_user";
  const adminId = "compat_smoke_admin";
  const email = "compat@example.com";
  const adminEmail = "compat-admin@example.com";
  const password = "compat-pass-1234";

  // Cleanup
  await prisma.session.deleteMany({ where: { userId: { in: [userId, adminId] } } });
  await prisma.account.deleteMany({ where: { userId: { in: [userId, adminId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });

  console.log("═".repeat(60));
  console.log("BetterAuth compat layer smoke test");
  console.log("═".repeat(60));

  console.log("\n[setup] Creating test users...");
  const pw = await hash(password, 10);
  await prisma.user.create({
    data: { id: userId, email, name: "Compat User" },
  });
  await prisma.account.create({
    data: {
      userId,
      type: "credential",
      provider: "credential",
      providerAccountId: userId,
      password: pw,
    },
  });
  await prisma.user.create({
    data: { id: adminId, email: adminEmail, name: "Compat Admin" },
  });
  await prisma.account.create({
    data: {
      userId: adminId,
      type: "credential",
      provider: "credential",
      providerAccountId: adminId,
      password: pw,
    },
  });

  const { auth } = await import("../src/server/better-auth");
  const { getServerAuthSession } = await import("../src/server/auth");

  // Helper: get a real session cookie for a given user
  const signInAs = async (e: string): Promise<string> => {
    const res = await auth.api.signInEmail({
      body: { email: e, password },
      asResponse: true,
    });
    if (res.status !== 200) {
      throw new Error(`sign-in failed for ${e}: ${res.status}`);
    }
    const setCookie = res.headers.get("set-cookie") ?? "";
    return setCookie.split(";")[0] ?? "";
  };

  const makeReq = (cookie: string) =>
    ({ headers: { cookie } }) as any;

  // ─────────────────────────────────────────────────────────────────
  // [1] getServerAuthSession with no cookie → null
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[1] No cookie → null");
  const noSession = await getServerAuthSession({
    req: { headers: {} } as any,
  });
  check("returns null", noSession === null);

  // ─────────────────────────────────────────────────────────────────
  // [2] Fresh signin → compat session with matching user
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[2] Fresh signin → matching user in compat session");
  const cookie1 = await signInAs(email);
  const session1 = await getServerAuthSession({ req: makeReq(cookie1) });
  check("session is non-null", session1 !== null);
  check("user.id matches", session1?.user.id === userId);
  check("user.email matches", session1?.user.email === email);
  check("user.name matches", session1?.user.name === "Compat User");
  check("impersonator is undefined", session1?.user.impersonator === undefined);
  check(
    "expires is ISO string",
    typeof session1?.expires === "string" && !isNaN(Date.parse(session1!.expires)),
  );

  // ─────────────────────────────────────────────────────────────────
  // [3] Invalid cookie → null
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[3] Invalid/tampered cookie → null");
  const tampered = await getServerAuthSession({
    req: makeReq("better-auth.session_token=garbage-not-a-real-token.signature"),
  });
  check("tampered cookie returns null", tampered === null);

  // ─────────────────────────────────────────────────────────────────
  // [4] Admin impersonation via Session.impersonating JSON
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[4] Admin impersonates target user");
  const adminCookie = await signInAs(adminEmail);
  // Look up the admin's session row
  const adminSessions = await prisma.session.findMany({
    where: { userId: adminId },
    orderBy: { createdAt: "desc" },
  });
  const adminSessionRow = adminSessions[0];
  check("admin has a session row", !!adminSessionRow);
  if (adminSessionRow) {
    await prisma.session.update({
      where: { id: adminSessionRow.id },
      data: {
        impersonating: {
          id: userId,
          name: "Compat User",
          email,
          image: null,
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      },
    });

    const impersonated = await getServerAuthSession({
      req: makeReq(adminCookie),
    });
    check("session is non-null", !!impersonated);
    check(
      "user.id is the target",
      impersonated?.user.id === userId,
      impersonated?.user.id,
    );
    check(
      "user.email is the target's",
      impersonated?.user.email === email,
    );
    check(
      "impersonator.id is the real admin",
      impersonated?.user.impersonator?.id === adminId,
    );
    check(
      "impersonator.email is the admin's",
      impersonated?.user.impersonator?.email === adminEmail,
    );
    check(
      "impersonator has no pendingSsoSetup leak",
      !("pendingSsoSetup" in (impersonated?.user.impersonator ?? {})),
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // [5] Expired impersonation → falls back to admin session
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[5] Expired impersonation → real admin session");
  if (adminSessionRow) {
    await prisma.session.update({
      where: { id: adminSessionRow.id },
      data: {
        impersonating: {
          id: userId,
          name: "Compat User",
          email,
          image: null,
          expires: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });
    const afterExpire = await getServerAuthSession({
      req: makeReq(adminCookie),
    });
    check(
      "falls back to admin id",
      afterExpire?.user.id === adminId,
    );
    check(
      "impersonator is undefined",
      afterExpire?.user.impersonator === undefined,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // [6] Concurrent getServerAuthSession calls don't race
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[6] Concurrent calls return consistent sessions");
  const cookieForConcurrent = await signInAs(email);
  const results = await Promise.all([
    getServerAuthSession({ req: makeReq(cookieForConcurrent) }),
    getServerAuthSession({ req: makeReq(cookieForConcurrent) }),
    getServerAuthSession({ req: makeReq(cookieForConcurrent) }),
    getServerAuthSession({ req: makeReq(cookieForConcurrent) }),
    getServerAuthSession({ req: makeReq(cookieForConcurrent) }),
  ]);
  const allMatch = results.every((r) => r?.user.id === userId);
  check("all 5 concurrent calls return the same user", allMatch);

  // ─────────────────────────────────────────────────────────────────
  // [7] Headers passed as Headers object (App Router path)
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[7] App Router: headers as Headers object");
  const headerObj = new Headers();
  headerObj.set("cookie", cookieForConcurrent);
  const headersObjResult = await getServerAuthSession({
    req: { headers: headerObj } as any,
  });
  check(
    "Headers object works the same as plain object",
    headersObjResult?.user.id === userId,
  );

  // ─────────────────────────────────────────────────────────────────
  // [8] pendingSsoSetup flag round-trip
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[8] pendingSsoSetup flag is forwarded to the session");
  await prisma.user.update({
    where: { id: userId },
    data: { pendingSsoSetup: true },
  });
  const withFlag = await getServerAuthSession({
    req: makeReq(cookieForConcurrent),
  });
  check(
    "pendingSsoSetup is true in the session",
    withFlag?.user.pendingSsoSetup === true,
  );
  // Reset for cleanup
  await prisma.user.update({
    where: { id: userId },
    data: { pendingSsoSetup: false },
  });

  // ─────────────────────────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────────────────────────

  console.log("\n[cleanup] Removing test data...");
  await prisma.session.deleteMany({ where: { userId: { in: [userId, adminId] } } });
  await prisma.account.deleteMany({ where: { userId: { in: [userId, adminId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });

  await prisma.$disconnect();

  console.log("\n" + "═".repeat(60));
  if (exitCode) {
    console.error("❌ COMPAT SMOKE TEST FAILED");
  } else {
    console.log("✅ ALL CHECKS PASSED");
  }
  console.log("═".repeat(60));

  setTimeout(() => process.exit(exitCode), 100);
}

main().catch(async (err) => {
  console.error("COMPAT SMOKE TEST CRASHED:", err);
  process.exit(1);
});
