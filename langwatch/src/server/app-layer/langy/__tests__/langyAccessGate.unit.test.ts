import { describe, expect, it, vi } from "vitest";
import { hasLangyAccess } from "../langyAccessGate";

describe("hasLangyAccess", () => {
  describe("when the rollout flag is off", () => {
    it("denies access", async () => {
      const isEnabled = vi.fn().mockResolvedValue(false);

      await expect(
        hasLangyAccess({
          user: { id: "customer-1" },
          projectId: "project-1",
          flags: { isEnabled },
        }),
      ).resolves.toBe(false);

      expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
        distinctId: "customer-1",
        projectId: "project-1",
      });
    });
  });

  describe("when the rollout flag is on", () => {
    it("grants access", async () => {
      const isEnabled = vi.fn().mockResolvedValue(true);

      await expect(
        hasLangyAccess({
          user: { id: "customer-2" },
          organizationId: "org-1",
          flags: { isEnabled },
        }),
      ).resolves.toBe(true);

      expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
        distinctId: "customer-2",
        organizationId: "org-1",
      });
    });
  });

  describe("given a verified @langwatch.ai address", () => {
    // Langy access is flag-only: the staff bypass that used to short-circuit
    // this gate was removed so the flag is a real kill switch rather than one
    // with a hole in it. Pin that a LangWatch address still goes through the
    // flag, so reintroducing an identity bypass fails here.
    it("evaluates the flag instead of bypassing it", async () => {
      const isEnabled = vi.fn().mockResolvedValue(false);

      await expect(
        hasLangyAccess({
          user: { id: "staff-1" },
          flags: { isEnabled },
        }),
      ).resolves.toBe(false);

      expect(isEnabled).toHaveBeenCalledOnce();
    });
  });

  describe("given neither a project nor an organization", () => {
    it("evaluates the flag at user scope only", async () => {
      const isEnabled = vi.fn().mockResolvedValue(false);

      // The GitHub install route has neither a projectId nor an organizationId
      // in hand, so the gate evaluates at user scope only.
      await expect(
        hasLangyAccess({
          user: { id: "customer-3" },
          flags: { isEnabled },
        }),
      ).resolves.toBe(false);

      expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
        distinctId: "customer-3",
      });
    });
  });
});
