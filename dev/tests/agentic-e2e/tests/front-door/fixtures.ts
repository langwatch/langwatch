/**
 * Front-door test fixtures: one distinct caller IP per test, via
 * `x-forwarded-for` (loopback is a trusted hop). Without it every CI test
 * shares one rate-limit bucket, breaking the sign-in/out tolerance test.
 */
import { test as base } from "@playwright/test";

/**
 * A deterministic RFC 5737 TEST-NET-3 address (203.0.113.0/24) per test —
 * deterministic so a retry reuses its bucket, TEST-NET-3 since it can
 * never collide with a real peer.
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
  extraHTTPHeaders: async ({ browserName: _browserName }, use, testInfo) => {
    await use({ "x-forwarded-for": forwardedForTest(testInfo.testId) });
  },
  page: async ({ page }, use) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await use(page);
  },
});

export { expect } from "@playwright/test";
