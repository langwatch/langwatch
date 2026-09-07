import { InvalidRuntimeConfigError, RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { platformHealthServerConfigDefinition } from "../platform-health.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({
    name: "platform-health",
    definition: platformHealthServerConfigDefinition,
    source,
  }).value;

describe("given a deployment that configured the platform health surface", () => {
  describe("when its configuration is read", () => {
    it("reads the monitoring key and the probe credential", () => {
      expect(
        read({ PLATFORM_HEALTH_API_KEY: "monitor", PLATFORM_HEALTH_PROBE_API_KEY: "probe" }),
      ).toEqual({ apiKey: "monitor", probeApiKey: "probe" });
    });
  });

  describe("when it exported the monitoring key with no value", () => {
    /** @scenario "A blank key is refused rather than read as unconfigured" */
    it("refuses the deployment rather than reading it as unconfigured", () => {
      expect(() => read({ PLATFORM_HEALTH_API_KEY: "" })).toThrow(InvalidRuntimeConfigError);
    });
  });
});
