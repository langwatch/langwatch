import { describe, expect, it, vi } from "vitest";
import {
  confirmUnsubscribe,
  maskEmail,
  resolveUnsubscribe,
} from "../unsubscribe.read";
import { signUnsubscribeToken } from "../unsubscribeToken";

describe("maskEmail", () => {
  describe("given an ordinary address", () => {
    it("keeps the first letter and the domain", () => {
      expect(maskEmail("alice@example.com")).toBe("a***@example.com");
    });
  });

  describe("given a single-character local part", () => {
    it("still masks without leaking the character count", () => {
      expect(maskEmail("a@example.com")).toBe("a***@example.com");
    });
  });
});

describe("resolveUnsubscribe", () => {
  const deps = {
    lookupNames: vi.fn(),
  };

  describe("given a valid trigger-scoped token", () => {
    it("returns masked email plus project and trigger names", async () => {
      deps.lookupNames.mockResolvedValue({
        projectName: "My Project",
        triggerName: "Latency Alert",
      });
      const token = signUnsubscribeToken({
        projectId: "p1",
        triggerId: "t1",
        email: "alice@example.com",
      });
      const result = await resolveUnsubscribe({ token, deps });
      expect(result).toEqual({
        projectName: "My Project",
        triggerName: "Latency Alert",
        email: "a***@example.com",
      });
      expect(deps.lookupNames).toHaveBeenCalledWith({
        projectId: "p1",
        triggerId: "t1",
      });
    });
  });

  describe("given a tampered token", () => {
    it("returns null without looking anything up", async () => {
      deps.lookupNames.mockClear();
      const result = await resolveUnsubscribe({ token: "garbage.sig", deps });
      expect(result).toBeNull();
      expect(deps.lookupNames).not.toHaveBeenCalled();
    });
  });

  describe("given a valid token whose project no longer exists", () => {
    it("returns null", async () => {
      deps.lookupNames.mockResolvedValue(null);
      const token = signUnsubscribeToken({
        projectId: "gone",
        triggerId: "t1",
        email: "x@y.com",
      });
      expect(await resolveUnsubscribe({ token, deps })).toBeNull();
    });
  });
});

describe("confirmUnsubscribe", () => {
  describe("given a valid token and trigger scope", () => {
    it("suppresses the trigger-scoped recipient", async () => {
      const suppress = vi.fn().mockResolvedValue(undefined);
      const token = signUnsubscribeToken({
        projectId: "p1",
        triggerId: "t1",
        email: "alice@example.com",
      });
      await confirmUnsubscribe({
        token,
        scope: "trigger",
        deps: { suppress },
      });
      expect(suppress).toHaveBeenCalledWith({
        projectId: "p1",
        email: "alice@example.com",
        triggerId: "t1",
      });
    });
  });

  describe("given a valid token and project scope", () => {
    it("suppresses across the whole project (null triggerId)", async () => {
      const suppress = vi.fn().mockResolvedValue(undefined);
      const token = signUnsubscribeToken({
        projectId: "p1",
        triggerId: "t1",
        email: "alice@example.com",
      });
      await confirmUnsubscribe({
        token,
        scope: "project",
        deps: { suppress },
      });
      expect(suppress).toHaveBeenCalledWith({
        projectId: "p1",
        email: "alice@example.com",
        triggerId: null,
      });
    });
  });

  describe("given a tampered token", () => {
    it("throws and records no suppression", async () => {
      const suppress = vi.fn();
      await expect(
        confirmUnsubscribe({
          token: "garbage.sig",
          scope: "trigger",
          deps: { suppress },
        }),
      ).rejects.toThrow();
      expect(suppress).not.toHaveBeenCalled();
    });
  });
});
