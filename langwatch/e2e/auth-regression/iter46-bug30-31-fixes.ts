/**
 * Iter 46 regression test for the two bug fixes:
 *
 *   Bug 30: tRPC `user.register` had no per-IP rate limit. Fixed
 *           in src/server/api/routers/user.ts via the new
 *           src/server/rateLimit.ts helper (20 requests / hour
 *           per IP, mirroring BetterAuth's `/sign-up/email`).
 *
 *   Bug 31: BetterAuth's origin-check middleware skips validation
 *           when a request has no Cookie header AND no Sec-Fetch
 *           headers, by design (REST-client / mobile-app support).
 *           That means a non-browser attacker could POST to
 *           `/api/auth/sign-up/email` from any origin and create
 *           accounts. Fixed by adding a Next.js wrapper around
 *           `auth.handler` in src/pages/api/auth/[...all].ts that
 *           rejects POST/PUT/DELETE/PATCH requests whose Origin
 *           (or Referer fallback) doesn't match NEXTAUTH_URL.
 */
import { _resetMemoryRateLimitStore } from "../../src/server/rateLimit";
import { prisma } from "../../src/server/db";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:5571";
const TS = Date.now();

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
  _resetMemoryRateLimitStore();

  try {
    // ────────────────────────────────────────────────────────────
    // Bug 31: Cross-origin /sign-up/email is now rejected even
    //         without Sec-Fetch headers (closes the BetterAuth
    //         origin-check bypass for non-browser clients)
    // ────────────────────────────────────────────────────────────
    console.log("\n[1] Bug 31: cross-origin /sign-up/email → 403");
    const csrfRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({
        email: `iter46-csrf-${TS}@test.com`,
        password: "attackerpass123",
        name: "Attacker",
      }),
    });
    check(
      "cross-origin POST returns 403",
      csrfRes.status === 403,
      `status=${csrfRes.status}`,
    );
    const csrfBody = (await csrfRes.json().catch(() => null)) as {
      code?: string;
    } | null;
    check(
      "response has code=INVALID_ORIGIN",
      csrfBody?.code === "INVALID_ORIGIN",
      csrfBody?.code,
    );
    check(
      "no Set-Cookie returned from rejected request",
      !(csrfRes.headers.get("set-cookie") ?? "").includes(
        "better-auth.session_token",
      ),
    );

    console.log("\n[2] Bug 31: missing Origin AND missing Referer → 403");
    const noOriginRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `iter46-noorigin-${TS}@test.com`,
        password: "attackerpass123",
        name: "Attacker",
      }),
    });
    check(
      "POST with no Origin/Referer rejected",
      noOriginRes.status === 403,
      `status=${noOriginRes.status}`,
    );

    console.log("\n[3] Bug 31: same-origin POST still works (sanity)");
    const okRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: BASE_URL,
      },
      body: JSON.stringify({
        email: `iter46-legit-${TS}@test.com`,
        password: "legitpass1234",
        name: "Legit",
      }),
    });
    check(
      "same-origin POST returns 200",
      okRes.status === 200,
      `status=${okRes.status}`,
    );
    check(
      "same-origin POST sets session cookie",
      (okRes.headers.get("set-cookie") ?? "").includes(
        "better-auth.session_token",
      ),
    );

    console.log("\n[4] Bug 31: GET /api/auth/get-session bypasses gate");
    const getSessionRes = await fetch(`${BASE_URL}/api/auth/get-session`, {
      method: "GET",
      headers: { Origin: "https://evil.example.com" },
    });
    check(
      "cross-origin GET get-session returns 200 (not gated)",
      getSessionRes.status === 200,
      `status=${getSessionRes.status}`,
    );

    // ────────────────────────────────────────────────────────────
    // Bug 30: tRPC user.register has per-IP rate limit (20/hour)
    // ────────────────────────────────────────────────────────────
    console.log("\n[5] Bug 30: tRPC user.register rate limit (20/hour)");
    // Drain any prior state from the dev server's rate-limit bucket.
    // The dev server uses Redis with key prefix langwatch:ratelimit;
    // localhost requests bucket as `unknown` because getClientIp
    // returns undefined for ::1/::ffff::1.
    let lastSuccess = 0;
    let firstRejection = 0;
    let rejectionsContinued = true;
    for (let i = 1; i <= 25; i++) {
      const r = await fetch(`${BASE_URL}/api/trpc/user.register?batch=1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: BASE_URL,
        },
        body: JSON.stringify({
          "0": {
            json: {
              name: "Spam",
              email: `iter46-bug30-${i}-${TS}@test.com`,
              password: "spampass1234",
            },
          },
        }),
      });
      if (r.status === 200) {
        lastSuccess = i;
      } else if (r.status === 429 && firstRejection === 0) {
        firstRejection = i;
      } else if (r.status !== 429 && firstRejection > 0) {
        rejectionsContinued = false;
      }
    }
    console.log(
      `  → lastSuccess=${lastSuccess}, firstRejection=${firstRejection}, rejectionsContinued=${rejectionsContinued}`,
    );
    check(
      "rate limit kicks in within first 21 requests",
      firstRejection > 0 && firstRejection <= 21,
      `firstRejection=${firstRejection}`,
    );
    check(
      "rate limit allows at least one success before rejecting",
      lastSuccess > 0,
      `lastSuccess=${lastSuccess}`,
    );
    check(
      "all subsequent requests after first rejection also rejected",
      rejectionsContinued,
    );
  } finally {
    // Scope cleanup to this run's TS suffix (CodeRabbit). iter46 creates
    // ~25 spam users to exercise the rate limit, all sharing this suffix.
    const runSuffix = `-${TS}@test.com`;
    await prisma.session.deleteMany({
      where: { user: { email: { endsWith: runSuffix } } },
    });
    await prisma.account.deleteMany({
      where: { user: { email: { endsWith: runSuffix } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: runSuffix } },
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
