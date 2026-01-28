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
    process.env.UI_SIMULATIONS_SCENARIOS = "1";
    expect(checkFlagEnvOverride("ui-simulations-scenarios")).toBe(true);
  });

  it("returns false when env var is set to 0", () => {
    process.env.UI_SIMULATIONS_SCENARIOS = "0";
    expect(checkFlagEnvOverride("ui-simulations-scenarios")).toBe(false);
  });

  it("returns undefined when env var is not set", () => {
    delete process.env.UI_SIMULATIONS_SCENARIOS;
    expect(checkFlagEnvOverride("ui-simulations-scenarios")).toBeUndefined();
  });

  it("returns undefined for other values", () => {
    process.env.UI_SIMULATIONS_SCENARIOS = "true";
    expect(checkFlagEnvOverride("ui-simulations-scenarios")).toBeUndefined();

    process.env.UI_SIMULATIONS_SCENARIOS = "false";
    expect(checkFlagEnvOverride("ui-simulations-scenarios")).toBeUndefined();

    process.env.UI_SIMULATIONS_SCENARIOS = "";
    expect(checkFlagEnvOverride("ui-simulations-scenarios")).toBeUndefined();
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
