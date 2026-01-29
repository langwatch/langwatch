import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkFlagEnvOverride } from "../envOverride";

describe("checkFlagEnvOverride", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns true when env var is set to 1", () => {
    process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "1";
    expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBe(true);
  });

  it("returns false when env var is set to 0", () => {
    process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "0";
    expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBe(false);
  });

  it("returns undefined when env var is not set", () => {
    delete process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED;
    expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBeUndefined();
  });

  it("returns undefined for other values", () => {
    process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "true";
    expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBeUndefined();

    process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "false";
    expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBeUndefined();

    process.env.RELEASE_UI_SIMULATIONS_MENU_ENABLED = "";
    expect(checkFlagEnvOverride("release_ui_simulations_menu_enabled")).toBeUndefined();
  });

  it("converts dashes to underscores and uppercases", () => {
    process.env.MY_FEATURE_FLAG = "1";
    expect(checkFlagEnvOverride("my-feature-flag")).toBe(true);
  });

  it("handles flags with multiple dashes", () => {
    process.env.ES_TRACE_PROCESSING_COMMAND_RECORDSPAN_KILLSWITCH = "0";
    expect(
      checkFlagEnvOverride("es-trace_processing-command-recordSpan-killSwitch"),
    ).toBe(false);
  });
});
