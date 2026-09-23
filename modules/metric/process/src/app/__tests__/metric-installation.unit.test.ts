import { createApiFixture } from "@langwatch/api-fixture";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { createApp } from "@langwatch/kernel";
import { MetricApi } from "@langwatch/metric-contract";
import { describe, expect, it, vi } from "vitest";

import { metricServer } from "../../metric.server.ts";

/**
 * The one member `MetricApp` declares reading (`reads: ["clickhouse"]`). This
 * suite prepares only, so the pipeline's own append repository is never reached.
 */
function unreachableClickHouse(): ClickHouseQueryClient {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`This test did not expect to reach ClickHouse.${String(property)}`);
      },
    },
  ) as unknown as ClickHouseQueryClient;
}

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
  return createApp({ role: "api" })
    .withModules([metricServer])
    .withAnalytical(unreachableClickHouse())
    .withConfig({ metric: { processingShards: void 0 } })
    .provide({
      "data-privacy": createApiFixture<DataPrivacyApi>({ redactMetricAttributes }),
    });
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
