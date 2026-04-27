/**
 * Iter 43 browser QA script: runs Playwright headless directly against
 * the dev server to verify the signin UI actually renders and the full
 * signup → get-session → signout loop works end-to-end.
 *
 * Bypasses the Claude-in-Chrome / Playwright MCP tooling conflict by
 * spawning its own isolated Chromium instance. Not intended for CI —
 * this is a manual verification script that runs once per audit.
 *
 * Run via:
 *   DATABASE_URL=... NEXTAUTH_URL=... NEXTAUTH_SECRET=... NEXTAUTH_PROVIDER=email \
 *     pnpm exec tsx e2e/auth-regression/iter43-browser-qa.ts
 *
 * Requires the dev server to be running on NEXTAUTH_URL.
 */
import { chromium } from "playwright";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:5571";
const EMAIL = `iter43-qa-${Date.now()}@test.com`;
const PASSWORD = "iter43pass1234";
const NAME = "Iter43 QA";

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
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("\n[1] Signup page renders the form");
  await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: "networkidle" });
  await page.waitForSelector("form", { timeout: 10000 });
  const formCount = await page.locator("form").count();
  const inputCount = await page.locator("input").count();
  const signupBtn = await page.locator('button:has-text("Sign up")').count();
  check("form present", formCount >= 1, `count=${formCount}`);
  check("at least 4 inputs (name, email, password, confirm)", inputCount >= 4, `count=${inputCount}`);
  check("Sign up button present", signupBtn >= 1);

  console.log("\n[2] Fill + submit signup form");
  await page.fill('input[type="email"]', EMAIL);
  const pwFields = await page.locator('input[type="password"]').all();
  check("two password fields (pw + confirm)", pwFields.length === 2);
  // Guard against out-of-bounds indexing if the form rendered fewer than
  // two password inputs. Without this, a failed `check` above just logs
  // and Lines 55-56 crash the whole script. CodeRabbit flagged this.
  if (pwFields.length < 2) {
    throw new Error(
      `expected 2 password inputs on signup form, found ${pwFields.length}`,
    );
  }
  await page.fill('input[name="name"]', NAME);
  await pwFields[0]!.fill(PASSWORD);
  await pwFields[1]!.fill(PASSWORD);
  await page.click('button:has-text("Sign up")');
  try {
    await page.waitForURL((url) => !url.toString().includes("/auth/signup"), { timeout: 15000 });
    check("navigated away from /auth/signup after submit", true, page.url());
  } catch {
    check(
      "navigated away from /auth/signup after submit",
      false,
      `still at ${page.url()}`,
    );
  }

  console.log("\n[3] Session cookie is set");
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) =>
    c.name.includes("better-auth.session_token"),
  );
  check("better-auth.session_token cookie present", !!sessionCookie);
  if (sessionCookie) {
    check("cookie is HttpOnly", sessionCookie.httpOnly === true);
    check(
      "cookie SameSite is Lax",
      String(sessionCookie.sameSite).toLowerCase() === "lax",
      String(sessionCookie.sameSite),
    );
  }

  console.log("\n[4] Session is active via API");
  const getSessionRes = await page.request.get(`${BASE_URL}/api/auth/get-session`);
  check("GET /api/auth/get-session → 200", getSessionRes.status() === 200);
  const sessionJson = await getSessionRes.json();
  check(
    "session.user.email matches signup email",
    sessionJson?.user?.email === EMAIL,
    sessionJson?.user?.email,
  );

  console.log("\n[5] Sign out");
  const signOutRes = await page.request.post(`${BASE_URL}/api/auth/sign-out`, {
    headers: { "Content-Type": "application/json", Origin: BASE_URL },
  });
  check("POST /api/auth/sign-out → 200", signOutRes.status() === 200);

  console.log("\n[6] Session is gone after signout");
  const afterSignout = await page.request.get(`${BASE_URL}/api/auth/get-session`);
  const afterJson = await afterSignout.json();
  check("get-session returns null after signout", afterJson === null);

  console.log("\n[7] Signin page renders with stale cookie jar");
  await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: "networkidle" });
  await page.waitForSelector("form", { timeout: 10000 });
  const signinFormCount = await page.locator("form").count();
  const signinInputCount = await page.locator("input").count();
  check("form present on signin page", signinFormCount >= 1);
  check(
    "email + password inputs present on signin page",
    signinInputCount >= 2,
    `count=${signinInputCount}`,
  );

  console.log("\n[8] Signin flow works with the same credentials");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Sign in")');
  try {
    await page.waitForURL((url) => !url.toString().includes("/auth/signin"), { timeout: 15000 });
    check("navigated away from /auth/signin", true, page.url());
  } catch {
    check(
      "navigated away from /auth/signin",
      false,
      `still at ${page.url()}`,
    );
  }

  console.log("\n[9] /auth/error page renders with friendly message");
  await page.goto(`${BASE_URL}/auth/error?error=OAuthAccountNotLinked`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(500);
  const errorBody = await page.textContent("body");
  check(
    "error page mentions 'OAuthAccountNotLinked'",
    !!errorBody && errorBody.includes("OAuthAccountNotLinked"),
  );

  console.log("\n[10] /auth/error normalizes BetterAuth native codes");
  await page.goto(`${BASE_URL}/auth/error?error=email_doesn't_match`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(500);
  const normalizedBody = await page.textContent("body");
  check(
    "error page maps email_doesn't_match → DIFFERENT_EMAIL_NOT_ALLOWED friendly message",
    !!normalizedBody &&
      normalizedBody.includes("different email address"),
  );

  await browser.close();

  console.log(`\n═══════════════════════════════════════════════════`);
  if (fails === 0) {
    console.log(`✅ ALL CHECKS PASSED (${passes}/${passes})`);
    process.exit(0);
  } else {
    console.log(`❌ ${fails} CHECKS FAILED (${passes}/${passes + fails} passed)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("SMOKE TEST CRASHED:", err);
  process.exit(1);
});
