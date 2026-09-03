import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { describe, expect, it, vi } from "vitest";
import {
  FeatureFlagLangyUiActionSurfaceAdapter,
  LANGY_UI_ACTIONS_FLAG,
} from "@langwatch/langy-server";

const INPUT = { userId: "user-1", projectId: "project-1", organizationId: "org-1" };

function makeFlags(isEnabled: FeatureFlagService["isEnabled"]): FeatureFlagService {
  return { isEnabled } as unknown as FeatureFlagService;
}

describe("FeatureFlagLangyUiActionSurfaceAdapter", () => {
  describe("given the flag store answers", () => {
    it("resolves the flag's answer for the project target", async () => {
      const isEnabled = vi.fn(async () => true);
      const adapter = FeatureFlagLangyUiActionSurfaceAdapter.create(makeFlags(isEnabled));

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
      const adapter = FeatureFlagLangyUiActionSurfaceAdapter.create(makeFlags(isEnabled));

      await expect(adapter.resolve(INPUT)).resolves.toBe(false);
    });
  });
});
