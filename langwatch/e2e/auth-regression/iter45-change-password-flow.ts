/**
 * Iter 45 extended browser QA: verifies the change-password →
 * revokeOtherSessions flow (iter 26 wiring) end-to-end in a real
 * browser with TWO independent sessions.
 *
 * Scenario:
 *   1. Sign up a user.
 *   2. Sign in the SAME user from TWO separate browser contexts
 *      (= two distinct Session rows).
 *   3. Change the password from context A via the tRPC mutation
 *      (simulates what the /settings/authentication form does).
 *   4. Verify context A is STILL signed in (keepSessionId preserves
 *      the caller's session).
 *   5. Verify context B is signed OUT (revokeOtherSessionsForUser
 *      killed the other Session row).
 *   6. Verify the old password no longer works.
 *   7. Verify the new password does work.
 *
 * Also exercises the CSRF / Origin-check on /api/auth/sign-out
 * as a sanity check (same-origin should succeed).
 *
 * Requires dev server on $NEXTAUTH_URL (default http://localhost:5571)
 * in NEXTAUTH_PROVIDER=email mode.
 */
import { chromium, type BrowserContext } from "playwright";
import { prisma } from "../../src/server/db";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:5571";
const TS = Date.now();
const EMAIL = `iter45-${TS}@test.com`;
const OLD_PASSWORD = "iter45oldpass123";
const NEW_PASSWORD = "iter45newpass456";

let passes = 0;
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fails++;
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
};

async function signUpAndIn(
  ctx: BrowserContext,
  email: string,
  password: string,
) {
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: "networkidle" });
  await page.waitForSelector("form", { timeout: 10000 });
  await page.fill('input[name="name"]', "Iter45 User");
  await page.fill('input[type="email"]', email);
  const pwFields = await page.locator('input[type="password"]').all();
  await pwFields[0]!.fill(password);
  await pwFields[1]!.fill(password);
  await page.click('button:has-text("Sign up")');
  await page.waitForURL(
    (url) => !url.toString().includes("/auth/signup"),
    { timeout: 15000 },
  );
  return page;
}

async function signIn(
  ctx: BrowserContext,
  email: string,
  password: string,
) {
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: "networkidle" });
  await page.waitForSelector("form", { timeout: 10000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  try {
    await page.waitForURL(
      (url) => !url.toString().includes("/auth/signin"),
      { timeout: 15000 },
    );
    return { page, ok: true };
  } catch {
    return { page, ok: false };
  }
}

async function getSessionEmail(ctx: BrowserContext): Promise<string | null> {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const res = await page.request.get(`${BASE_URL}/api/auth/get-session`);
  if (res.status() !== 200) return null;
  const body = await res.json();
  return body?.user?.email ?? null;
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    // ──────────────────────────────────────────────────────────────
    // [1] Sign up one user, then sign in from TWO separate contexts
    // ──────────────────────────────────────────────────────────────
    console.log("\n[1] Sign up + sign in from two contexts");
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    const pageA0 = await signUpAndIn(ctxA, EMAIL, OLD_PASSWORD);
    check("context A: signup succeeded", !pageA0.url().includes("/auth/signup"));

    // Context B signs in fresh — this creates a SECOND Session row.
    const signInB = await signIn(ctxB, EMAIL, OLD_PASSWORD);
    check("context B: signin succeeded", signInB.ok);

    // Both contexts should have independent session cookies.
    const cookiesA = await ctxA.cookies();
    const cookiesB = await ctxB.cookies();
    const cookieA = cookiesA.find((c) =>
      c.name.includes("better-auth.session_token"),
    );
    const cookieB = cookiesB.find((c) =>
      c.name.includes("better-auth.session_token"),
    );
    check("context A: has session cookie", !!cookieA);
    check("context B: has session cookie", !!cookieB);
    check(
      "context A and B have DIFFERENT session tokens",
      cookieA?.value !== cookieB?.value,
    );

    // DB-level verification: expect two Session rows for this user.
    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    check("user row exists in DB", !!user);
    const sessionsBefore = await prisma.session.findMany({
      where: { userId: user!.id },
    });
    check(
      "two Session rows in DB before change-password",
      sessionsBefore.length === 2,
      `count=${sessionsBefore.length}`,
    );

    // Sanity check: both contexts report a valid session via API.
    const emailA1 = await getSessionEmail(ctxA);
    const emailB1 = await getSessionEmail(ctxB);
    check("context A: get-session reports user", emailA1 === EMAIL);
    check("context B: get-session reports user", emailB1 === EMAIL);

    // ──────────────────────────────────────────────────────────────
    // [2] Change password from context A via the tRPC mutation
    //     (simulating what /settings/authentication submits)
    // ──────────────────────────────────────────────────────────────
    console.log("\n[2] Change password from context A");
    const tRpcBody = {
      "0": {
        json: {
          currentPassword: OLD_PASSWORD,
          newPassword: NEW_PASSWORD,
        },
      },
    };
    const changeRes = await pageA0.request.post(
      `${BASE_URL}/api/trpc/user.changePassword?batch=1`,
      {
        headers: { "Content-Type": "application/json" },
        data: tRpcBody,
      },
    );
    const changeStatus = changeRes.status();
    const changeJson = await changeRes.json().catch(() => null);
    check(
      "changePassword tRPC mutation: 200",
      changeStatus === 200,
      `status=${changeStatus}`,
    );
    const success =
      Array.isArray(changeJson) &&
      changeJson[0]?.result?.data?.json?.success === true;
    check("changePassword response: success=true", success);

    // ──────────────────────────────────────────────────────────────
    // [3] Context A should STILL be signed in (keepSessionId)
    // ──────────────────────────────────────────────────────────────
    console.log("\n[3] Context A session preserved");
    const emailA2 = await getSessionEmail(ctxA);
    check(
      "context A: still reports session after password change",
      emailA2 === EMAIL,
      emailA2 ?? "null",
    );

    // ──────────────────────────────────────────────────────────────
    // [4] Context B should be SIGNED OUT (other session revoked)
    // ──────────────────────────────────────────────────────────────
    console.log("\n[4] Context B revoked");
    const emailB2 = await getSessionEmail(ctxB);
    check(
      "context B: get-session returns null after change-password",
      emailB2 === null,
      emailB2 ?? "null",
    );

    // Final DB verification: only ONE Session row should remain for
    // this user (the one matching context A's keepSessionId).
    const sessionsAfter = await prisma.session.findMany({
      where: { userId: user!.id },
    });
    check(
      "exactly one Session row remains in DB",
      sessionsAfter.length === 1,
      `count=${sessionsAfter.length}`,
    );

    // ──────────────────────────────────────────────────────────────
    // [5] Old password is now rejected; new password works
    // ──────────────────────────────────────────────────────────────
    console.log("\n[5] Old password rejected, new password accepted");
    const ctxC = await browser.newContext();
    const oldPwSignIn = await signIn(ctxC, EMAIL, OLD_PASSWORD);
    check(
      "signin with OLD password: rejected",
      !oldPwSignIn.ok,
      oldPwSignIn.page.url(),
    );
    await ctxC.close();

    const ctxD = await browser.newContext();
    const newPwSignIn = await signIn(ctxD, EMAIL, NEW_PASSWORD);
    check(
      "signin with NEW password: accepted",
      newPwSignIn.ok,
      newPwSignIn.page.url(),
    );
    await ctxD.close();

    // ──────────────────────────────────────────────────────────────
    // [6] Same-origin sign-out works (baseline CSRF sanity)
    // ──────────────────────────────────────────────────────────────
    console.log("\n[6] Same-origin sign-out");
    const signOutRes = await pageA0.request.post(
      `${BASE_URL}/api/auth/sign-out`,
      {
        headers: { "Content-Type": "application/json", Origin: BASE_URL },
      },
    );
    check(
      "POST /api/auth/sign-out (same origin): 200",
      signOutRes.status() === 200,
      `status=${signOutRes.status()}`,
    );
    const emailA3 = await getSessionEmail(ctxA);
    check(
      "context A: session gone after sign-out",
      emailA3 === null,
      emailA3 ?? "null",
    );

    await ctxA.close();
    await ctxB.close();
  } finally {
    await browser.close();

    // Clean up test users.
    // Scope cleanup to the exact test user (CodeRabbit).
    await prisma.session.deleteMany({
      where: { user: { email: EMAIL } },
    });
    await prisma.account.deleteMany({
      where: { user: { email: EMAIL } },
    });
    await prisma.user.deleteMany({
      where: { email: EMAIL },
    });
  }

  console.log(`\n═══════════════════════════════════════════════════`);
  if (fails === 0) {
    console.log(`✅ ALL CHECKS PASSED (${passes}/${passes})`);
    process.exit(0);
  } else {
    console.log(
      `❌ ${fails} CHECKS FAILED (${passes}/${passes + fails} passed)`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("SMOKE TEST CRASHED:", err);
  process.exit(1);
});
