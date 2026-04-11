/**
 * Iter 49 regression test for bug 36: tRPC `changePassword` lacks
 * rate limit, allowing brute-force of `currentPassword` from a
 * stolen session token.
 *
 * Scenario:
 *   1. Sign up a fresh user.
 *   2. Hit changePassword 6 times with WRONG currentPassword.
 *   3. Verify: first 5 return UNAUTHORIZED ("Current password is
 *      incorrect"), 6th returns TOO_MANY_REQUESTS.
 *   4. Verify with correct password: still rate-limited (the budget
 *      is per-user, not per-attempt-outcome).
 *   5. Wait for reset (in dev with SKIP_REDIS=1 the in-memory store
 *      persists for the script's lifetime, so we can't easily test
 *      reset — we just verify rate-limit fires).
 */
import { chromium } from "playwright";
import { prisma } from "../src/server/db";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:5571";
const TS = Date.now();
const EMAIL = `iter49-bug36-${TS}@test.com`;
const REAL_PW = "iter49realpw1234";

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

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Sign up fresh user
    await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: "networkidle" });
    await page.waitForSelector("form", { timeout: 10000 });
    await page.fill('input[name="name"]', "Bug36 Test");
    await page.fill('input[type="email"]', EMAIL);
    const pwFields = await page.locator('input[type="password"]').all();
    await pwFields[0]!.fill(REAL_PW);
    await pwFields[1]!.fill(REAL_PW);
    await page.click('button:has-text("Sign up")');
    await page.waitForURL(
      (url) => !url.toString().includes("/auth/signup"),
      { timeout: 15000 },
    );
    console.log(`\n[setup] signed up ${EMAIL}`);

    // Hit changePassword with WRONG current password 6 times
    console.log("\n[1] Brute-force attempts with wrong current password");
    const results: Array<{ status: number; code: string | null }> = [];
    for (let i = 1; i <= 6; i++) {
      const r = await page.request.post(
        `${BASE_URL}/api/trpc/user.changePassword?batch=1`,
        {
          headers: { "Content-Type": "application/json", Origin: BASE_URL },
          data: {
            "0": {
              json: {
                currentPassword: `wrong-attempt-${i}`,
                newPassword: "iter49newpw1234",
              },
            },
          },
        },
      );
      const body = (await r.json().catch(() => null)) as
        | Array<{ error?: { json?: { data?: { code?: string } } } }>
        | null;
      const errCode = body?.[0]?.error?.json?.data?.code ?? null;
      results.push({ status: r.status(), code: errCode });
      console.log(`     attempt ${i}: HTTP ${r.status()} code=${errCode}`);
    }

    const unauthorizedCount = results.filter(
      (r) => r.code === "UNAUTHORIZED",
    ).length;
    const tooManyCount = results.filter(
      (r) => r.code === "TOO_MANY_REQUESTS",
    ).length;
    check(
      "first 5 attempts return UNAUTHORIZED",
      unauthorizedCount === 5,
      `count=${unauthorizedCount}`,
    );
    check(
      "6th attempt returns TOO_MANY_REQUESTS",
      tooManyCount === 1,
      `count=${tooManyCount}`,
    );

    // Even with the CORRECT password, the user should still be rate-limited
    console.log("\n[2] Correct password: still rate-limited");
    const correctRes = await page.request.post(
      `${BASE_URL}/api/trpc/user.changePassword?batch=1`,
      {
        headers: { "Content-Type": "application/json", Origin: BASE_URL },
        data: {
          "0": {
            json: {
              currentPassword: REAL_PW,
              newPassword: "iter49newpw5678",
            },
          },
        },
      },
    );
    const correctBody = (await correctRes.json().catch(() => null)) as
      | Array<{ error?: { json?: { data?: { code?: string } } } }>
      | null;
    const correctCode = correctBody?.[0]?.error?.json?.data?.code ?? null;
    check(
      "correct password still rate-limited",
      correctCode === "TOO_MANY_REQUESTS",
      `code=${correctCode}`,
    );

    // Verify the password did NOT actually change (user can still
    // sign in with the original password).
    console.log("\n[3] Verify password did not change");
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(`${BASE_URL}/auth/signin`, { waitUntil: "networkidle" });
    await page2.waitForSelector("form", { timeout: 10000 });
    await page2.fill('input[type="email"]', EMAIL);
    await page2.fill('input[type="password"]', REAL_PW);
    await page2.click('button:has-text("Sign in")');
    let signinOk = false;
    try {
      await page2.waitForURL(
        (url) => !url.toString().includes("/auth/signin"),
        { timeout: 10000 },
      );
      signinOk = true;
    } catch {}
    check(
      "user can still sign in with ORIGINAL password",
      signinOk,
      page2.url(),
    );

    await ctx.close();
    await ctx2.close();
  } finally {
    await browser.close();
    await prisma.session.deleteMany({
      where: { user: { email: { contains: "iter49-bug36" } } },
    });
    await prisma.account.deleteMany({
      where: { user: { email: { contains: "iter49-bug36" } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: "iter49-bug36" } },
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
