// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/api-fixture";
import type { IncomingUsageReport, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import { createTestLogger, frozenAt, memoryRateLimiter } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryProductAnalyticsChannel } from "../../channels/memory/memory.product-analytics.channel.ts";
import { LangWatchCloudService } from "../langwatch-cloud.service.ts";
import { UsageReportReceiverService } from "../usage-report-receiver.service.ts";

const RECEIVED_AT = "2026-09-23T08:00:00.000Z";
const recorded: IncomingUsageReport[] = [];

/** Refuses exactly the keys it is told to, and remembers every key it was asked about. */
function limiterRefusing(...refused: string[]): RateLimiter & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    check(key) {
      asked.push(key);
      return Promise.resolve({ allowed: !refused.includes(key) });
    },
  };
}

function setup({
  isSaas = true,
  rateLimiter = memoryRateLimiter(),
  recordUsageReport = (report: IncomingUsageReport) => {
    recorded.push(report);
    return Promise.resolve([]);
  },
}: {
  isSaas?: boolean;
  rateLimiter?: RateLimiter;
  recordUsageReport?: LicensingApi["recordUsageReport"];
} = {}) {
  const analytics = MemoryProductAnalyticsChannel.create();
  const { logger, lines } = createTestLogger();
  const receiver = UsageReportReceiverService.create({
    cloud: LangWatchCloudService.create({ isSaas }),
    rateLimiter,
    registry: createApiFixture<LicensingApi>({ recordUsageReport }),
    analytics,
    clock: frozenAt(RECEIVED_AT),
    logger,
  });
  return { receiver, analytics, lines };
}

function report(extra: Record<string, unknown> = {}) {
  return {
    report: { event: "daily_usage_stats", instance_id: "install-1", version: "3.1.0", ...extra },
    addressHeaders: { "x-forwarded-for": "203.0.113.7" },
  };
}

describe("UsageReportReceiverService", () => {
  describe("when Cloud receives a report", () => {
    /** @scenario "An accepted report is recorded and sent to product analytics" */
    it("records the known fields and sends the same event on, counting the unknown ones", async () => {
      recorded.length = 0;
      const { receiver, analytics } = setup();

      await expect(receiver.receive(report({ from_the_future: 1 }))).resolves.toEqual({
        message: "Event captured",
      });

      expect(recorded).toEqual([
        {
          instanceId: "install-1",
          properties: { version: "3.1.0" },
          unknownFields: 1,
          receivedAt: RECEIVED_AT,
        },
      ]);
      expect(analytics.captured).toEqual([
        {
          distinctId: "install-1",
          event: "daily_usage_stats",
          properties: { version: "3.1.0", unknown_fields: 1 },
        },
      ]);
    });

    /** @scenario "A report the registry cannot store is still accepted" */
    /** @scenario "Storage failing never refuses the report" */
    it("answers the report and logs when the registry fails", async () => {
      const { receiver, analytics, lines } = setup({
        recordUsageReport: () => Promise.reject(new Error("registry down")),
      });

      await expect(receiver.receive(report())).resolves.toEqual({ message: "Event captured" });
      expect(analytics.captured).toHaveLength(1);
      expect(lines.findLine("error", "not recorded in the install registry")).toBeDefined();
    });
  });

  describe("when the receiver is past a limit", () => {
    /** @scenario "Reports past the global, per-address or per-install limit are refused" */
    it.each([
      ["global", "track_usage:global"],
      ["per-address", "track_usage:ip:203.0.113.7"],
      ["per-install", "track_usage:instance:install-1"],
    ])("refuses at the %s limit before recording anything", async (_, key) => {
      recorded.length = 0;
      const { receiver, analytics } = setup({ rateLimiter: limiterRefusing(key) });

      await expect(receiver.receive(report())).rejects.toMatchObject({ code: "rate_limited" });
      expect(recorded).toEqual([]);
      expect(analytics.captured).toEqual([]);
    });

    it("counts no per-address bucket where the sender named no address", async () => {
      const limiter = limiterRefusing();
      const { receiver } = setup({ rateLimiter: limiter });

      await receiver.receive({ ...report(), addressHeaders: {} });

      expect(limiter.asked).toEqual(["track_usage:global", "track_usage:instance:install-1"]);
    });
  });

  describe("when the deployment is not LangWatch Cloud", () => {
    /** @scenario "Any other deployment refuses Cloud's routes by code" */
    it("refuses before counting, recording or sending anything", async () => {
      recorded.length = 0;
      const limiter = limiterRefusing();
      const { receiver, analytics } = setup({ isSaas: false, rateLimiter: limiter });

      await expect(receiver.receive(report())).rejects.toMatchObject({
        code: "langwatch_cloud_only",
      });
      expect(limiter.asked).toEqual([]);
      expect(recorded).toEqual([]);
      expect(analytics.captured).toEqual([]);
    });
  });
});
