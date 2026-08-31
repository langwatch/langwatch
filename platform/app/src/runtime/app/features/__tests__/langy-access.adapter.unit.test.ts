import { describe, expect, it, vi } from "vitest";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { hasLangyAccess } from "../langy-access.adapter";

function featureFlags(enabled: boolean) {
  const service = MemoryFeatureFlagService.create();
  service.setFlag("release_langy_enabled", enabled);
  const isEnabled = vi.spyOn(service, "isEnabled");

  return { service, isEnabled };
}

describe("hasLangyAccess", () => {
  describe("when the rollout flag is off", () => {
    it("denies access", async () => {
      const { service, isEnabled } = featureFlags(false);

      await expect(
        hasLangyAccess({
          user: { id: "customer-1" },
          projectId: "project-1",
          featureFlags: service,
        }),
      ).resolves.toBe(false);

      // A server read says "no such scope" with the union's own discriminator,
      // not with the browser's `NOT_TARGETED` sentinel: the service turns a
      // project target's `organizationId` straight into an ORGANIZATION subject
      // to look rules up by, so a placeholder id would be looked up as though it
      // named a real organization. Absent stays absent.
      expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
        kind: "project",
        userId: "customer-1",
        projectId: "project-1",
        organizationId: undefined,
      });
    });
  });

  describe("when the rollout flag is on", () => {
    it("grants access", async () => {
      const { service, isEnabled } = featureFlags(true);

      await expect(
        hasLangyAccess({
          user: { id: "customer-2" },
          organizationId: "org-1",
          featureFlags: service,
        }),
      ).resolves.toBe(true);

      expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
        kind: "organization",
        userId: "customer-2",
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
      const { service, isEnabled } = featureFlags(false);

      await expect(
        hasLangyAccess({
          user: { id: "staff-1" },
          featureFlags: service,
        }),
      ).resolves.toBe(false);

      expect(isEnabled).toHaveBeenCalledOnce();
    });
  });

  describe("given neither a project nor an organization", () => {
    it("evaluates the flag at user scope only", async () => {
      const { service, isEnabled } = featureFlags(false);

      // The GitHub install route has neither a projectId nor an organizationId
      // in hand, so the gate states both scopes as not targeted.
      await expect(
        hasLangyAccess({
          user: { id: "customer-3" },
          featureFlags: service,
        }),
      ).resolves.toBe(false);

      expect(isEnabled).toHaveBeenCalledWith("release_langy_enabled", {
        kind: "user",
        userId: "customer-3",
      });
    });
  });
});
