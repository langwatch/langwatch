/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { testSignInCallbackUrl } from "../test-sign-in-callback-url.ts";

describe("where a test sign-in returns to", () => {
  it("keeps the page and puts the asked-for query on it", () => {
    expect(
      testSignInCallbackUrl({
        href: "https://app.test/settings/sso",
        query: { ssoTest: "conn_1" },
      }),
    ).toBe("https://app.test/settings/sso?ssoTest=conn_1");
  });

  it("drops what the address carried, so an earlier verdict cannot survive the attempt", () => {
    expect(
      testSignInCallbackUrl({
        href: "https://app.test/settings/sso?error=bad&error_description=why",
        query: { ssoTest: "conn_1" },
      }),
    ).toBe("https://app.test/settings/sso?ssoTest=conn_1");
  });

  it("leaves a key nobody answered off the address entirely", () => {
    expect(
      testSignInCallbackUrl({
        href: "https://app.test/settings/sso",
        query: { ssoTest: "conn_1", error: undefined },
      }),
    ).toBe("https://app.test/settings/sso?ssoTest=conn_1");
  });

  it("keeps the fragment the page was read at", () => {
    expect(
      testSignInCallbackUrl({
        href: "https://app.test/settings/sso#go-live",
        query: { ssoTest: "conn_1" },
      }),
    ).toBe("https://app.test/settings/sso?ssoTest=conn_1#go-live");
  });
});
