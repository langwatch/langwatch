import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { MetricApi } from "@langwatch/metric-contract";
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { metricServer } from "../../metric.server.ts";

const GAUGE_REQUEST = {
  resourceMetrics: [
    {
      scopeMetrics: [
        {
          scope: { name: "scope" },
          metrics: [
            {
              name: "gauge",
              gauge: { dataPoints: [{ timeUnixNano: "1700000000000000000", asDouble: 1.5 }] },
            },
          ],
        },
      ],
    },
  ],
};

function process(redactMetricAttributes: DataPrivacyApi["redactMetricAttributes"]) {
  return createApp({ role: "api", config: {} })
    .withProvided(DataPrivacyApi, createApiFixture<DataPrivacyApi>({ redactMetricAttributes }))
    .withModules([withMemoryRepositories(metricServer)]);
}

describe("metric app installation", () => {
  describe("given a process that provides the data-privacy capability", () => {
    /** @scenario "The metric capability is installed by the process that boots it" */
    it("answers under its own token and prepares an export request", async () => {
      const redactMetricAttributes = vi.fn<DataPrivacyApi["redactMetricAttributes"]>(
        async () => {},
      );
      const runtime = await process(redactMetricAttributes).boot();

      try {
        const app = runtime.service(MetricApi);

        expect(runtime.module(metricServer).provided).toBe(app);

        const preparation = await app.prepareMetricDataPoints({
          tenantId: "project-1",
          organizationId: "organization-1",
          request: GAUGE_REQUEST,
          piiRedactionLevel: "STRICT",
          acceptedAt: 1_800_000_000_000,
        });

        expect(preparation.rejectedDataPoints).toBe(0);
        expect(preparation.accepted.map(({ dataPoint }) => dataPoint.metricName)).toEqual([
          "gauge",
        ]);
        expect(redactMetricAttributes).toHaveBeenCalled();
      } finally {
        await runtime.stop();
      }
    });
  });
});
