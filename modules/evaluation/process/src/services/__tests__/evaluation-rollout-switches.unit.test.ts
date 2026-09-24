import { createApiFixture } from "@langwatch/api-fixture";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";

import { FlaggedEvaluationInputsOffloadService } from "../evaluation-inputs-offload-switch.service.ts";
import { EvaluationSettingsRecoverySwitchService } from "../evaluation-settings-recovery-switch.service.ts";

function flags(enabled: readonly string[]) {
  return createApiFixture<FeatureFlagApi>({
    isEnabled: async (key, target) => target.kind === "system" && enabled.includes(key),
  });
}

const offloaded = { __lw_stored_object: "marker" };
const request = { tenantId: "project-1", evaluationId: "eval-1", inputs: { input: "large" } };

describe("EvaluationSettingsRecoverySwitchService", () => {
  it("reads the system-wide recovery kill switch", async () => {
    await expect(
      EvaluationSettingsRecoverySwitchService.create(
        flags(["ops_evaluator_settings_recovery_disabled"]),
      ).isDisabled(),
    ).resolves.toBe(true);
    await expect(
      EvaluationSettingsRecoverySwitchService.create(flags([])).isDisabled(),
    ).resolves.toBe(false);
  });
});

describe("FlaggedEvaluationInputsOffloadService", () => {
  const inputs = { offload: async () => offloaded };

  describe("given offloading is switched off", () => {
    it("keeps the inputs inline", async () => {
      const service = FlaggedEvaluationInputsOffloadService.create({
        inputs,
        flags: flags(["ops_evaluation_payload_offload_disabled"]),
      });

      await expect(service.offload(request)).resolves.toEqual(request.inputs);
    });
  });

  describe("given offloading is on", () => {
    it("offloads through the input store", async () => {
      const service = FlaggedEvaluationInputsOffloadService.create({ inputs, flags: flags([]) });

      await expect(service.offload(request)).resolves.toEqual(offloaded);
    });
  });
});
