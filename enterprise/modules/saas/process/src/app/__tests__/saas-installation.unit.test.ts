import { type IncomingUsageReport, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { SaasApi } from "@langwatch/enterprise-saas-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { saasProcessModule } from "../../saas.module.ts";

function boot({ isSaas, recorded }: { isSaas: boolean; recorded: IncomingUsageReport[] }) {
  return bootInstalledProcess({
    role: "api",
    modules: [saasProcessModule],
    config: {
      saas: { isSaas, latestRelease: void 0, latestReleaseCommit: void 0 },
    },
    stores: memoryStores(),
    peers: [
      testPeer({
        token: LicensingApi,
        instance: createApiFixture<LicensingApi>({
          recordUsageReport: (report) => {
            recorded.push(report);
            return Promise.resolve([]);
          },
        }),
      }),
    ],
  });
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

      expect(runtime.module(saasProcessModule).provided).toBe(app);
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
