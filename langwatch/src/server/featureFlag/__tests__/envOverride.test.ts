import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkFlagEnvOverride } from "../envOverride";

describe("checkFlagEnvOverride()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("when env var is set to 1", () => {
    it("returns true", () => {
      process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "1";
      expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBe(true);
    });
  });

  describe("when env var is set to 0", () => {
    it("returns false", () => {
      process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "0";
      expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBe(false);
    });
  });

  describe("when env var is not set", () => {
    it("returns undefined", () => {
      delete process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED;
      expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBeUndefined();
    });
  });

  describe("when env var has invalid value", () => {
    it("returns undefined for 'true'", () => {
      process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "true";
      expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBeUndefined();
    });

    it("returns undefined for 'false'", () => {
      process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "false";
      expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "";
      expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBeUndefined();
    });
  });

  describe("when flag name has dashes", () => {
    it("converts to underscores and uppercases", () => {
      process.env.MY_FEATURE_FLAG = "1";
      expect(checkFlagEnvOverride("my-feature-flag")).toBe(true);
    });
  });

  describe("when flag name has mixed case and multiple dashes", () => {
    it("normalizes correctly", () => {
      process.env.ES_TRACE_PROCESSING_COMMAND_RECORDSPAN_KILLSWITCH = "0";
      expect(
        checkFlagEnvOverride("es-trace_processing-command-recordSpan-killSwitch"),
      ).toBe(false);
    });
  });
});
