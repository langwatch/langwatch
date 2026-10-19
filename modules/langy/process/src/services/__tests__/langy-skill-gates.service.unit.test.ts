import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { LangySkillGatesService } from "../langy-skill-gates.service.ts";

const INPUT = { userId: "user-1", projectId: "project-1", organizationId: "org-1" };
const DASHBOARDS_FLAG = "release_dashboards";

function makeFlags(isEnabled: FeatureFlagApi["isEnabled"]): FeatureFlagApi {
  return createApiFixture<FeatureFlagApi>({ isEnabled });
}

describe("LangySkillGatesService", () => {
  describe("given Dashboards is off", () => {
    /** @scenario "Langy builds saved charts when Dashboards is off" */
    it("withholds dashboard-widgets and keeps lwql-charts", async () => {
      const isEnabled = vi.fn(async () => false);

      const disabled = await LangySkillGatesService.create(makeFlags(isEnabled)).resolveDisabled(
        INPUT,
      );

      expect(disabled).toEqual(["dashboard-widgets"]);
      expect(isEnabled).toHaveBeenCalledTimes(1);
      expect(isEnabled).toHaveBeenCalledWith(DASHBOARDS_FLAG, {
        kind: "project",
        ...INPUT,
      });
    });
  });

  describe("given Dashboards is on", () => {
    /** @scenario "Langy builds dashboard widgets when Dashboards is on" */
    it("withholds lwql-charts", async () => {
      const isEnabled = vi.fn(async (flag: string) => flag === DASHBOARDS_FLAG);

      const disabled = await LangySkillGatesService.create(makeFlags(isEnabled)).resolveDisabled(
        INPUT,
      );

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
