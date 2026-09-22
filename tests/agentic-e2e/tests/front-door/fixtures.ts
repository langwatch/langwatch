/**
 * Front-door test fixtures: one distinct caller IP per test.
 *
 * The signed-out auth surface is rate-limited per caller (auth.route 60/hour
 * per IP, sign-in/email 50 per 15 minutes, and the sign-up budgets). In CI
 * every test reaches the app over loopback, so without this they all share
 * ONE bucket — and since the identifier-first flow asks the router on every
 * sign-in, a whole run's worth of front-door journeys spends that bucket well
 * before the last tests run. The rate-limit tolerance test ("signing in and
 * out several times never hits the limit") was then failing on other tests'
 * traffic, not its own.
 *
 * A loopback peer is a trusted hop by default (see getClientIp:
 * `isInfrastructureHop`), so its `x-forwarded-for` is honoured with no
 * `TRUSTED_PROXY_ADDRESSES` set. Stamping each test's context with a distinct
 * forwarded address gives every test its own bucket — which is exactly what a
 * distinct real user has, so the tolerance test now measures one user's
 * cycles rather than the whole suite's. `extraHTTPHeaders` on the context
 * rides every request the test makes: navigations, in-browser fetches, and
 * `page.request`.
 */
import { test as base } from "@playwright/test";

/**
 * A deterministic RFC 5737 TEST-NET-3 address (203.0.113.0/24) per test.
 * Deterministic so a retry of the same test reuses its bucket rather than
 * minting a fresh one and hiding a real per-user limit regression; TEST-NET-3
 * because it is reserved for exactly this and can never collide with a real
 * peer. The id is hashed into the last octet's 1..254 range.
 */
function forwardedForTest(testId: string): string {
  let hash = 0;
  for (let i = 0; i < testId.length; i++) {
    hash = (hash * 31 + testId.charCodeAt(i)) >>> 0;
  }
  const octet = (hash % 254) + 1;
  return `203.0.113.${octet}`;
}

export const test = base.extend({
  extraHTTPHeaders: async ({}, use, testInfo) => {
    await use({ "x-forwarded-for": forwardedForTest(testInfo.testId) });
  },
});

export { expect } from "@playwright/test";
