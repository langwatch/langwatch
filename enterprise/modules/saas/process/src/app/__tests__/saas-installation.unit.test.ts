// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { IncomingUsageReport, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { SaasApi } from "@langwatch/enterprise-saas-contract";
import { createApp } from "@langwatch/kernel";
import type { OpsApi } from "@langwatch/ops-contract";
import { memoryStores } from "@langwatch/process-stores";
import { createTestLogger, frozenAt, memoryRateLimiter } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { saasServer } from "../../saas.server.ts";

function boot({ isSaas, recorded }: { isSaas: boolean; recorded: IncomingUsageReport[] }) {
  const { logger } = createTestLogger();
  return createApp({ role: "api" })
    .withModules([saasServer])
    .withStores(memoryStores())
    .withMembers({ isSaas, rateLimiter: memoryRateLimiter(), clock: frozenAt() })
    .withObservability((observability) => observability.withLogging(logger))
    .provide({
      ops: createApiFixture<OpsApi>({ findProductAnalyticsTargets: () => [] }),
      licensing: createApiFixture<LicensingApi>({
        recordUsageReport: (report) => {
          recorded.push(report);
          return Promise.resolve([]);
        },
      }),
    })
    .boot();
}

const REQUEST = {
  report: { event: "daily_usage_stats", instance_id: "install-1" },
  addressHeaders: {},
};

describe("saas installation", () => {
  /** @scenario "Cloud answers its own routes" */
  it("boots over memory stores on Cloud and records a received report", async () => {
    const recorded: IncomingUsageReport[] = [];
    const runtime = await boot({ isSaas: true, recorded });

    try {
      const app = runtime.service(SaasApi);

      expect(runtime.module(saasServer).provided).toBe(app);
      await expect(app.receiveUsageReport(REQUEST)).resolves.toEqual({
        message: "Event captured",
      });
      expect(recorded).toMatchObject([{ instanceId: "install-1" }]);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "Any other deployment refuses Cloud's routes by code" */
  it("boots over memory stores off Cloud and refuses the report by code", async () => {
    const recorded: IncomingUsageReport[] = [];
    const runtime = await boot({ isSaas: false, recorded });

    try {
      await expect(runtime.service(SaasApi).receiveUsageReport(REQUEST)).rejects.toMatchObject({
        code: "langwatch_cloud_only",
      });
      expect(recorded).toEqual([]);
    } finally {
      await runtime.stop();
    }
  });
});
