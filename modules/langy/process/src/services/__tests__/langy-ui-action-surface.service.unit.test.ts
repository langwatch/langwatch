import { createApiFixture } from "@langwatch/api-fixture";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { LangyUiActionSurfaceService, LANGY_UI_ACTIONS_FLAG } from "@langwatch/langy-process";
import { describe, expect, it, vi } from "vitest";

const INPUT = { userId: "user-1", projectId: "project-1", organizationId: "org-1" };

function makeFlags(isEnabled: FeatureFlagApi["isEnabled"]): FeatureFlagApi {
  return createApiFixture<FeatureFlagApi>({ isEnabled });
}

describe("LangyUiActionSurfaceService", () => {
  describe("given the flag store answers", () => {
    it("resolves the flag's answer for the project target", async () => {
      const isEnabled = vi.fn(async () => true);
      const adapter = LangyUiActionSurfaceService.create(makeFlags(isEnabled));

      await expect(adapter.resolve(INPUT)).resolves.toBe(true);

      expect(isEnabled).toHaveBeenCalledWith(LANGY_UI_ACTIONS_FLAG, {
        kind: "project",
        userId: INPUT.userId,
        projectId: INPUT.projectId,
        organizationId: INPUT.organizationId,
      });
    });
  });

  describe("given the flag store rejects", () => {
    /** @scenario A flag-store blip must not stop the turn, and must not advertise a surface it could not confirm */
    it("resolves to false", async () => {
      const isEnabled = vi.fn(async () => {
        throw new Error("flag store unavailable");
      });
      const adapter = LangyUiActionSurfaceService.create(makeFlags(isEnabled));

      await expect(adapter.resolve(INPUT)).resolves.toBe(false);
    });
  });
});
