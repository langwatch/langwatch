import { createApiFixture } from "@langwatch/api-fixture";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { LANGY_SKILL_GATE_FLAG } from "@langwatch/langy-contract";
import { LangySkillGatesService } from "@langwatch/langy-process";
import { describe, expect, it, vi } from "vitest";

const INPUT = { userId: "user-1", projectId: "project-1", organizationId: "org-1" };

function makeFlags(isEnabled: FeatureFlagApi["isEnabled"]): FeatureFlagApi {
  return createApiFixture<FeatureFlagApi>({ isEnabled });
}

describe("LangySkillGatesService", () => {
  describe("given the gating flag is off", () => {
    it("withholds the flagged skill and keeps the one it excludes", async () => {
      const isEnabled = vi.fn(async () => false);

      const disabled = await LangySkillGatesService.create(makeFlags(isEnabled)).resolveDisabled(
        INPUT,
      );

      expect(disabled).toEqual(["dashboard-widgets"]);
      expect(isEnabled).toHaveBeenCalledTimes(1);
      expect(isEnabled).toHaveBeenCalledWith(LANGY_SKILL_GATE_FLAG, {
        kind: "project",
        ...INPUT,
      });
    });
  });

  describe("given the gating flag is on", () => {
    it("withholds the stable skill the flagged one replaces", async () => {
      const disabled = await LangySkillGatesService.create(
        makeFlags(vi.fn(async () => true)),
      ).resolveDisabled(INPUT);

      expect(disabled).toEqual(["lwql-charts"]);
    });
  });

  describe("given the flag store rejects", () => {
    it("reads the flag as off rather than failing the turn", async () => {
      const isEnabled = vi.fn(async () => {
        throw new Error("flag store unavailable");
      });

      const disabled = await LangySkillGatesService.create(makeFlags(isEnabled)).resolveDisabled(
        INPUT,
      );

      expect(disabled).toEqual(["dashboard-widgets"]);
    });
  });
});
