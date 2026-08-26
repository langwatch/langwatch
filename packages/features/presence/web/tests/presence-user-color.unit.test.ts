import { describe, expect, it } from "vitest";
import type { PresenceSession, PresenceUser } from "@langwatch/presence-contract";
import {
  presenceDisplayName,
  presenceSessionColor,
  presenceUserColor,
  presenceUserDisplayName,
} from "../src/presence-user-color";

function user(overrides: Partial<PresenceUser> = {}): PresenceUser {
  return { id: "u1", name: "Alice", image: null, ...overrides };
}

function session(userOverrides: Partial<PresenceUser> = {}): PresenceSession {
  return {
    sessionId: "s1",
    projectId: "project-1",
    user: user(userOverrides),
    location: { lens: "traces", route: {} },
    updatedAt: 0,
  };
}

describe("given presenceUserDisplayName", () => {
  describe("when the user has no name", () => {
    it("falls back to Someone", () => {
      expect(presenceUserDisplayName(user({ name: null }))).toBe("Someone");
    });
  });

  describe("when the user has a name", () => {
    it("returns it verbatim", () => {
      expect(presenceUserDisplayName(user({ name: "Bob" }))).toBe("Bob");
    });
  });
});

describe("given presenceUserColor", () => {
  describe("when hashing a known display name", () => {
    it("matches the app's rotatingColors 'colors' hash for that name", () => {
      // Same 8-name order and sum-of-char-codes hash as
      // platform/app/src/utils/rotatingColors.ts's `getColorForString("colors", ...)`.
      expect(presenceUserColor(user({ name: "Alice" }))).toBe("cyan.emphasized");
      expect(presenceUserColor(user({ name: "Bob" }))).toBe("yellow.emphasized");
    });
  });

  describe("when called twice for the same name", () => {
    it("is deterministic", () => {
      const first = presenceUserColor(user({ name: "Charlie Rivera" }));
      const second = presenceUserColor(user({ name: "Charlie Rivera" }));
      expect(first).toBe(second);
    });
  });

  describe("when the user has no name", () => {
    it("hashes the Someone fallback", () => {
      expect(presenceUserColor(user({ name: null }))).toBe("cyan.emphasized");
    });
  });
});

describe("given the session-scoped wrappers", () => {
  it("presenceDisplayName reads through to the session's user", () => {
    expect(presenceDisplayName(session({ name: "Dana" }))).toBe("Dana");
  });

  it("presenceSessionColor reads through to the session's user", () => {
    expect(presenceSessionColor(session({ name: "Alice" }))).toBe("cyan.emphasized");
  });
});
