/**
 * What a replay of one migration appends to run as goose's compat pass would: the relaxed
 * aggregating-dimension setting through 00086, and only where the server enforces the check.
 */
import { describe, expect, it } from "vitest";

import { dimensionCompatSettingFor } from "../goose.migration-runner.ts";

describe("dimensionCompatSettingFor", () => {
  describe("when the server enforces the check", () => {
    it("relaxes a migration up to 00086", () => {
      expect(dimensionCompatSettingFor({ version: 86, serverEnforces: true })).toBe(
        ", allow_dimensions_outside_sorting_key = 1",
      );
    });

    it("leaves a later migration to the check", () => {
      expect(dimensionCompatSettingFor({ version: 87, serverEnforces: true })).toBe("");
    });
  });

  describe("when the server does not know the setting", () => {
    it("appends nothing, which the server would reject", () => {
      expect(dimensionCompatSettingFor({ version: 1, serverEnforces: false })).toBe("");
    });
  });
});
