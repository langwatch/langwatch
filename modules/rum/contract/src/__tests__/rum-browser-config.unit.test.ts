import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { rumBrowserConfig, rumConfig } from "../rum.config.ts";

const COLLECTOR = "http://collector.test:4318";

async function projected(environment: Readonly<Record<string, string | undefined>>) {
  const config = parseProcessConfig({ owners: [{ name: "rum", config: rumConfig }], environment });
  return rumBrowserConfig.project(config.rum, undefined);
}

describe("rum's browser config", () => {
  describe("given the switch is off", () => {
    /** @scenario "Browser tracing stays off while the switch is off" */
    it("disables browser tracing even with a collector configured", async () => {
      expect((await projected({ RUM_COLLECTOR_ENDPOINT: COLLECTOR })).enabled).toBe(false);
      const off = await projected({ RUM_ENABLED: "false", RUM_COLLECTOR_ENDPOINT: COLLECTOR });
      expect(off.enabled).toBe(false);
    });
  });

  describe("given the switch is on and a collector is configured", () => {
    /** @scenario "Browser tracing is on with the sample ratio when switched on and a collector is configured" */
    it("enables browser tracing with rum's own collector", async () => {
      expect(
        await projected({
          RUM_ENABLED: "true",
          RUM_SAMPLE_RATIO: "0.25",
          RUM_COLLECTOR_ENDPOINT: COLLECTOR,
        }),
      ).toEqual({ enabled: true, sampleRatio: 0.25 });
    });

    /** @scenario "Browser tracing is on with the sample ratio when switched on and a collector is configured" */
    it("enables browser tracing with the deprecated telemetry collector as the fallback", async () => {
      expect(
        await projected({
          RUM_ENABLED: "true",
          RUM_SAMPLE_RATIO: "0.25",
          OTEL_EXPORTER_OTLP_ENDPOINT: COLLECTOR,
        }),
      ).toEqual({ enabled: true, sampleRatio: 0.25 });
    });

    it("records every session when no sample ratio is set", async () => {
      expect(await projected({ RUM_ENABLED: "true", RUM_COLLECTOR_ENDPOINT: COLLECTOR })).toEqual({
        enabled: true,
        sampleRatio: 1,
      });
    });
  });

  describe("given the switch is on without a collector", () => {
    /** @scenario "Browser tracing stays off when switched on without a collector" */
    it("disables browser tracing", async () => {
      const projection = await projected({
        RUM_ENABLED: "true",
        RUM_COLLECTOR_ENDPOINT: "",
        OTEL_EXPORTER_OTLP_ENDPOINT: "",
      });
      expect(projection.enabled).toBe(false);
    });
  });
});
