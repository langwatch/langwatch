/**
 * Iter 49 regression test for bug 37: `unlinkAccount` had a TOCTOU
 * race that could leave a user with zero accounts under concurrent
 * calls. Fixed by wrapping count+delete in a Serializable transaction.
 *
 * Setup is awkward because BetterAuth normally has only ONE credential
 * account per user — to exercise the race, we directly insert a
 * second Account row at the DB level (simulating a "credential +
 * google" scenario). Then fire two parallel unlinkAccount mutations
 * targeting both accounts and verify the user ends up with EXACTLY
 * one account (not zero).
 */
import { chromium } from "playwright";
import { prisma } from "../../src/server/db";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:5571";
const TS = Date.now();
const EMAIL = `iter49-bug37-${TS}@test.com`;
const PASSWORD = "iter49unlinktest";

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

    // Sign up a user (creates 1 credential Account row).
    await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: "networkidle" });
    await page.waitForSelector("form", { timeout: 10000 });
    await page.fill('input[name="name"]', "Bug37 Test");
    await page.fill('input[type="email"]', EMAIL);
    const pwFields = await page.locator('input[type="password"]').all();
    if (pwFields.length !== 2) {
      throw new Error(
        `expected 2 password inputs on the signup form, found ${pwFields.length}`,
      );
    }
    await pwFields[0]!.fill(PASSWORD);
    await pwFields[1]!.fill(PASSWORD);
    await page.click('button:has-text("Sign up")');
    await page.waitForURL(
      (url) => !url.toString().includes("/auth/signup"),
      { timeout: 15000 },
    );

    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (!user) throw new Error("user row missing after signup");

    // Inject a SECOND Account row directly so we can exercise the race
    // (BetterAuth normally allows only one credential account, and we
    // don't want to drag a real OAuth provider into the test).
    await prisma.account.create({
      data: {
        userId: user.id,
        type: "oauth",
        provider: "iter49-fake-provider",
        providerAccountId: `iter49-fake-${TS}`,
      },
    });

    const initialCount = await prisma.account.count({
      where: { userId: user.id },
    });
    check(
      "user has exactly 2 accounts before race",
      initialCount === 2,
      `count=${initialCount}`,
    );

    const [acct1, acct2] = await prisma.account.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    if (!acct1 || !acct2) throw new Error("expected 2 account rows");

    console.log("\n[1] Fire two concurrent unlinkAccount calls");
    // Both calls arrive at "essentially the same time" — the previous
    // implementation would have both pass the count<=1 check then both
    // delete. The transaction-wrapped fix should serialize them, so
    // exactly one succeeds and the other fails.
    const callUnlink = (id: string) =>
      page.request.post(
        `${BASE_URL}/api/trpc/user.unlinkAccount?batch=1`,
        {
          headers: { "Content-Type": "application/json", Origin: BASE_URL },
          data: { "0": { json: { accountId: id } } },
        },
      );
    const [r1, r2] = await Promise.all([
      callUnlink(acct1.id),
      callUnlink(acct2.id),
    ]);
    console.log(`     r1: HTTP ${r1.status()}`);
    console.log(`     r2: HTTP ${r2.status()}`);

    const successCount = [r1, r2].filter((r) => r.status() === 200).length;
    const errorCount = [r1, r2].filter((r) => r.status() !== 200).length;
    console.log(`     successes=${successCount} errors=${errorCount}`);

    const finalCount = await prisma.account.count({
      where: { userId: user.id },
    });
    console.log(`     final account count: ${finalCount}`);
    check(
      "user has at least 1 account remaining (not zero)",
      finalCount >= 1,
      `final=${finalCount}`,
    );
    check(
      "exactly one unlink call succeeded",
      successCount === 1,
      `successes=${successCount}`,
    );
    check(
      "exactly one unlink call was rejected",
      errorCount === 1,
      `errors=${errorCount}`,
    );

    await ctx.close();
  } finally {
    await browser.close();
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
