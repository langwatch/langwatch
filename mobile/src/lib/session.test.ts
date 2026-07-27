import { describe, expect, it } from "vitest";

import {
  isAccessTokenExpired,
  parseStoredSession,
  sessionDisplayName,
  type StoredSession,
} from "./session";

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    instance: "https://app.langwatch.ai",
    accessToken: "lw_at_x",
    refreshToken: "lw_rt_x",
    accessTokenExpiresAt: Date.now() + 3_600_000,
    userId: "user-1",
    userEmail: "operator@langwatch.ai",
    userName: "Operator",
    organizationName: "LangWatch",
    ...overrides,
  };
}

describe("isAccessTokenExpired", () => {
  describe("given a token well inside its lifetime", () => {
    it("is not expired", () => {
      expect(isAccessTokenExpired(session())).toBe(false);
    });
  });

  describe("given a token past its expiry", () => {
    it("is expired", () => {
      expect(
        isAccessTokenExpired(session({ accessTokenExpiresAt: Date.now() - 1 })),
      ).toBe(true);
    });
  });

  describe("given a token about to expire", () => {
    it("counts as expired, so a slow request does not arrive with a dead credential", () => {
      expect(
        isAccessTokenExpired(
          session({ accessTokenExpiresAt: Date.now() + 30_000 }),
        ),
      ).toBe(true);
    });
  });
});

describe("sessionDisplayName", () => {
  it("prefers the name", () => {
    expect(sessionDisplayName(session())).toBe("Operator");
  });

  it("falls back to the email", () => {
    expect(sessionDisplayName(session({ userName: null }))).toBe(
      "operator@langwatch.ai",
    );
  });

  it("falls back again when the account has neither", () => {
    expect(
      sessionDisplayName(session({ userName: null, userEmail: null })),
    ).toBe("Signed in");
  });
});

describe("parseStoredSession", () => {
  it("round-trips what the app stored", () => {
    const original = session();

    expect(parseStoredSession(JSON.stringify(original))).toEqual(original);
  });

  describe("given nothing in the keystore", () => {
    it("answers null", () => {
      expect(parseStoredSession(null)).toBeNull();
    });
  });

  describe("given a corrupt entry", () => {
    it("answers null rather than throwing on launch", () => {
      // A corrupt entry should send the operator to the sign-in screen, not
      // crash the app before it draws.
      expect(parseStoredSession("{not json")).toBeNull();
      expect(parseStoredSession("null")).toBeNull();
      expect(parseStoredSession('{"instance":"https://x"}')).toBeNull();
    });
  });

  describe("given an entry from an older build without the optional fields", () => {
    it("fills them in as absent rather than rejecting the session", () => {
      const raw = JSON.stringify({
        instance: "https://app.langwatch.ai",
        accessToken: "lw_at_x",
        refreshToken: "lw_rt_x",
        accessTokenExpiresAt: 123,
        userId: "user-1",
      });

      expect(parseStoredSession(raw)).toEqual({
        instance: "https://app.langwatch.ai",
        accessToken: "lw_at_x",
        refreshToken: "lw_rt_x",
        accessTokenExpiresAt: 123,
        userId: "user-1",
        userEmail: null,
        userName: null,
        organizationName: null,
      });
    });
  });
});
