import { describe, expect, it } from "vitest";

import {
  DEFAULT_BIND_HOST,
  isLoopbackHost,
  isOriginAllowed,
  parseAllowedOrigins,
} from "../http-security.js";

describe("bind host", () => {
  it("defaults to loopback", () => {
    expect(DEFAULT_BIND_HOST).toBe("127.0.0.1");
    expect(isLoopbackHost(DEFAULT_BIND_HOST)).toBe(true);
  });

  it.each(["127.0.0.1", "localhost", "::1", "[::1]", " LOCALHOST "])(
    "recognises %s as loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(["0.0.0.0", "::", "192.168.1.10", "10.0.0.1", "example.com"])(
    "does not treat %s as loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("parseAllowedOrigins", () => {
  it("returns an empty list when nothing is configured", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });

  it("splits, trims, and normalizes entries", () => {
    expect(parseAllowedOrigins(" https://Example.com/ , https://app.test:8443 ")).toEqual(
      ["https://example.com", "https://app.test:8443"],
    );
  });

  it("drops entries that are not usable origins", () => {
    expect(parseAllowedOrigins("not-an-origin, https://ok.test")).toEqual([
      "https://ok.test",
    ]);
  });

  it("deduplicates equivalent origins", () => {
    expect(parseAllowedOrigins("https://a.test,https://a.test/")).toEqual([
      "https://a.test",
    ]);
  });
});

describe("isOriginAllowed", () => {
  it.each([
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "https://localhost",
  ])("always allows the loopback origin %s", (origin) => {
    expect(isOriginAllowed({ origin, allowedOrigins: [] })).toBe(true);
  });

  it("rejects an unlisted remote origin", () => {
    expect(isOriginAllowed({ origin: "https://evil.test", allowedOrigins: [] })).toBe(
      false,
    );
  });

  it("allows a configured remote origin", () => {
    expect(
      isOriginAllowed({
        origin: "https://app.test",
        allowedOrigins: ["https://app.test"],
      }),
    ).toBe(true);
  });

  it("matches on scheme, host and port together", () => {
    const allowlist = ["https://app.test"];
    expect(
      isOriginAllowed({ origin: "http://app.test", allowedOrigins: allowlist }),
    ).toBe(false);
    expect(
      isOriginAllowed({ origin: "https://app.test:8443", allowedOrigins: allowlist }),
    ).toBe(false);
    expect(
      isOriginAllowed({ origin: "https://other.test", allowedOrigins: allowlist }),
    ).toBe(false);
  });

  it("does not let a hostname that merely ends in localhost through", () => {
    expect(isOriginAllowed({ origin: "https://notlocalhost", allowedOrigins: [] })).toBe(
      false,
    );
    expect(
      isOriginAllowed({ origin: "https://evil-localhost.test", allowedOrigins: [] }),
    ).toBe(false);
  });

  it("rejects the opaque null origin", () => {
    expect(isOriginAllowed({ origin: "null", allowedOrigins: [] })).toBe(false);
  });

  it("treats a rebound attacker hostname as unlisted", () => {
    // DNS rebinding points an attacker hostname at loopback, but the browser
    // still sends the attacker hostname as the origin.
    expect(
      isOriginAllowed({ origin: "http://rebind.attacker.test", allowedOrigins: [] }),
    ).toBe(false);
  });
});
