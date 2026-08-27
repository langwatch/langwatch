import { describe, expect, it } from "vitest";
import {
  deriveFeatureFlagEnvVarName,
  resolveFeatureFlagEnvOverride,
} from "../src/feature-flag-environment";

function reader(values: Record<string, string>) {
  return (name: string): string | undefined => values[name];
}

describe("resolveFeatureFlagEnvOverride()", () => {
  describe("when the derived variable is set to 1", () => {
    it("returns true", () => {
      const override = resolveFeatureFlagEnvOverride({
        read: reader({ RELEASE_UI_SIMULATIONS_MENU_ENABLED: "1" }),
        flagKey: "release_ui_simulations_menu_enabled",
      });

      expect(override).toBe(true);
    });
  });

  describe("when the derived variable is set to 0", () => {
    it("returns false", () => {
      const override = resolveFeatureFlagEnvOverride({
        read: reader({ RELEASE_UI_SIMULATIONS_MENU_ENABLED: "0" }),
        flagKey: "release_ui_simulations_menu_enabled",
      });

      expect(override).toBe(false);
    });
  });

  describe("when the derived variable is not set", () => {
    it("returns undefined so resolution continues", () => {
      const override = resolveFeatureFlagEnvOverride({
        read: reader({}),
        flagKey: "release_ui_simulations_menu_enabled",
      });

      expect(override).toBeUndefined();
    });
  });

  describe("when the derived variable holds a value other than 1 or 0", () => {
    it.each(["true", "false", ""])("returns undefined for %j", (value) => {
      const override = resolveFeatureFlagEnvOverride({
        read: reader({ RELEASE_UI_SIMULATIONS_MENU_ENABLED: value }),
        flagKey: "release_ui_simulations_menu_enabled",
      });

      expect(override).toBeUndefined();
    });
  });

  describe("when the flag key carries dashes", () => {
    it("uppercases and converts them to underscores", () => {
      const override = resolveFeatureFlagEnvOverride({
        read: reader({ MY_FEATURE_FLAG: "1" }),
        flagKey: "my-feature-flag",
      });

      expect(override).toBe(true);
    });
  });

  describe("when the flag key mixes case and dashes", () => {
    it("normalises the whole key", () => {
      const override = resolveFeatureFlagEnvOverride({
        read: reader({ ES_TRACE_PROCESSING_COMMAND_RECORDSPAN_KILLSWITCH: "0" }),
        flagKey: "es-trace_processing-command-recordSpan-killSwitch",
      });

      expect(override).toBe(false);
    });
  });

  describe("when a legacy alias is declared", () => {
    it("honours its looser truthy semantics", () => {
      const override = resolveFeatureFlagEnvOverride({
        read: reader({ LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD: "yes" }),
        flagKey: "ops_es_causality_loop_guard_disabled",
        legacyEnvVar: "LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD",
      });

      expect(override).toBe(true);
    });

    it.each(["", "0", "false"])("reads %j as off", (value) => {
      const override = resolveFeatureFlagEnvOverride({
        read: reader({ LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD: value }),
        flagKey: "ops_es_causality_loop_guard_disabled",
        legacyEnvVar: "LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD",
      });

      expect(override).toBe(false);
    });

    it("lets the derived variable win over the alias", () => {
      const override = resolveFeatureFlagEnvOverride({
        read: reader({
          OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED: "0",
          LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD: "1",
        }),
        flagKey: "ops_es_causality_loop_guard_disabled",
        legacyEnvVar: "LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD",
      });

      expect(override).toBe(false);
    });
  });
});

describe("deriveFeatureFlagEnvVarName()", () => {
  it("uppercases the key and converts dashes to underscores", () => {
    expect(deriveFeatureFlagEnvVarName("token-estimation-killswitch")).toBe(
      "TOKEN_ESTIMATION_KILLSWITCH",
    );
  });
});
