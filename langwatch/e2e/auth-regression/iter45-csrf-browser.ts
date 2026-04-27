/**
 * Iter 45 CSRF browser test: verifies BetterAuth's Sec-Fetch-based
 * formCsrfMiddleware correctly blocks a real cross-origin browser
 * form submission targeting /api/auth/sign-up/email.
 *
 * Creates an HTML page served from a DIFFERENT origin (via
 * data: URL) that auto-submits a form POST to the langwatch
 * server. A real Chromium browser will send cross-site Sec-Fetch
 * headers; BetterAuth should respond with 403 Forbidden and no
 * Set-Cookie header.
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { prisma } from "../../src/server/db";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:5571";
const TS = Date.now();
const ATTACKER_EMAIL = `iter45-attacker-${TS}@test.com`;

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
  // Start an attacker origin server on a different port. Using 127.0.0.1
  // with a different port is enough to count as cross-site in Chromium's
  // Sec-Fetch-Site logic (port AND hostname form the "site").
  // Actually, port differences alone are cross-ORIGIN but same-SITE in
  // the fetch metadata spec. To trigger Sec-Fetch-Site: cross-site we
  // need a different "site" (eTLD+1). Using a hostname like "evil.test"
  // via /etc/hosts would work but we can't modify that. Instead, use
  // 127.0.0.1:port which is same-site to localhost:port (both are
  // "private" addresses).
  //
  // A reliable workaround: serve the attacker page from the SAME origin
  // as the langwatch server but have the form target a different origin.
  // That's the inverse problem. Actually, the simplest cross-site
  // simulation: serve from a different .localhost subdomain like
  // "evil.localhost". On most systems, *.localhost resolves to 127.0.0.1,
  // so we can bind to 127.0.0.1 and the browser will see "evil.localhost"
  // as a distinct site from "localhost".
  const ATTACKER_PORT = 5599;
  const attackerServer = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>Evil</title></head>
      <body>
        <h1>Evil site</h1>
        <form id="csrf" action="${BASE_URL}/api/auth/sign-up/email" method="POST" enctype="application/x-www-form-urlencoded">
          <input name="email" value="${ATTACKER_EMAIL}" />
          <input name="password" value="attackerpass123" />
          <input name="name" value="Attacker" />
        </form>
        <script>
          setTimeout(() => document.getElementById('csrf').submit(), 100);
        </script>
      </body>
      </html>
    `);
  });
  await new Promise<void>((resolve) =>
    attackerServer.listen(ATTACKER_PORT, "127.0.0.1", resolve),
  );

  const browser = await chromium.launch({ headless: true });

  try {
    console.log("\n[1] Cross-site form POST from evil.localhost → /sign-up/email");
    // Use "evil.localhost" so the browser sees it as a distinct site
    // from "localhost" (Sec-Fetch-Site: cross-site).
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const responses: Array<{ url: string; status: number; headers: Record<string, string> }> = [];
    page.on("response", (resp) => {
      if (resp.url().includes(BASE_URL)) {
        responses.push({
          url: resp.url(),
          status: resp.status(),
          headers: resp.headers(),
        });
      }
    });

    await page.goto(`http://evil.localhost:${ATTACKER_PORT}/`, {
      waitUntil: "networkidle",
    });
    // Give the form submission a moment to fire and bounce back.
    await page.waitForTimeout(2500);

    console.log(`  → saw ${responses.length} responses from ${BASE_URL}`);
    for (const r of responses) {
      console.log(`     ${r.status} ${r.url}`);
    }

    const signupResponse = responses.find((r) =>
      r.url.includes("/api/auth/sign-up/email"),
    );
    check(
      "cross-site POST to /sign-up/email reached server",
      !!signupResponse,
      signupResponse ? `status=${signupResponse.status}` : "no response",
    );
    check(
      "cross-site POST is REJECTED (403 Forbidden)",
      signupResponse?.status === 403,
      `status=${signupResponse?.status}`,
    );
    check(
      "cross-site POST did NOT set session_token cookie",
      !(signupResponse?.headers["set-cookie"] ?? "").includes(
        "better-auth.session_token",
      ),
      (signupResponse?.headers["set-cookie"] ?? "").slice(0, 80),
    );

    // Verify no user was created in the DB.
    const attackerUser = await prisma.user.findUnique({
      where: { email: ATTACKER_EMAIL },
    });
    check(
      "no User row created in DB for attacker email",
      !attackerUser,
    );

    // Verify the browser has NOT acquired a session cookie for BASE_URL.
    const cookies = await ctx.cookies(BASE_URL);
    const sessionCookie = cookies.find((c) =>
      c.name.includes("better-auth.session_token"),
    );
    check(
      "browser has no session cookie for langwatch after cross-site POST",
      !sessionCookie,
      sessionCookie?.value ?? "none",
    );

    await ctx.close();
  } finally {
    await browser.close();
    attackerServer.close();

    // Clean up any attacker user that might have been created.
    // Scope cleanup to the exact attacker email (CodeRabbit).
    await prisma.session.deleteMany({
      where: { user: { email: ATTACKER_EMAIL } },
    });
    await prisma.account.deleteMany({
      where: { user: { email: ATTACKER_EMAIL } },
    });
    await prisma.user.deleteMany({
      where: { email: ATTACKER_EMAIL },
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
