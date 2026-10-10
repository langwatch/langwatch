import type { IncomingUsageReport, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { createTestLogger } from "@langwatch/test-harness";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemorySaasRateLimitRepository } from "../../repositories/memory/memory.saas-rate-limit.repository.ts";
import type { SaasRateLimitRepository } from "../../repositories/saas-rate-limit.repository.ts";
import { LangWatchCloudService } from "../langwatch-cloud.service.ts";
import { UsageReportReceiverService } from "../usage-report-receiver.service.ts";

const RECEIVED_AT = "2026-09-23T08:00:00.000Z";
const recorded: IncomingUsageReport[] = [];

/** Refuses exactly the keys it is told to, and remembers every key it was asked about. */
function limiterRefusing(...refused: string[]): SaasRateLimitRepository & { asked: string[] } {
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
  rateLimits = MemorySaasRateLimitRepository.create(),
  recordUsageReport = (report: IncomingUsageReport) => {
    recorded.push(report);
    return Promise.resolve([]);
  },
  release = {},
  failFacts = false,
}: {
  failFacts?: boolean;
  isSaas?: boolean;
  release?: Partial<Parameters<typeof UsageReportReceiverService.create>[0]["release"]>;
  rateLimits?: SaasRateLimitRepository;
  recordUsageReport?: LicensingApi["recordUsageReport"];
} = {}) {
  const facts: unknown[] = [];
  const { logger, lines } = createTestLogger();
  const receiver = UsageReportReceiverService.create({
    cloud: LangWatchCloudService.create({ isSaas }),
    rateLimits,
    registry: createApiFixture<LicensingApi>({ recordUsageReport }),
    logger,
    release: {
      latestRelease: void 0,
      latestReleaseCommit: void 0,
      releaseFloor: void 0,
      ...release,
    },
  });
  receiver.connect({
    recordUsageReportReceived: {
      send: (payload) => {
        if (failFacts) return Promise.reject(new Error("event log down"));
        facts.push(payload);
        return Promise.resolve();
      },
    },
  });
  return { receiver, facts, lines };
}

function report(extra: Record<string, unknown> = {}) {
  return {
    report: { event: "daily_usage_stats", instance_id: "install-1", version: "3.1.0", ...extra },
    addressHeaders: { "x-forwarded-for": "203.0.113.7" },
  };
}

describe("UsageReportReceiverService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(RECEIVED_AT));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when Cloud receives a report", () => {
    /** @scenario "An accepted report is recorded and sent to product analytics" */
    it("records the known fields and the received fact, counting the unknown ones", async () => {
      recorded.length = 0;
      const { receiver, facts } = setup();

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
      expect(facts).toEqual([
        {
          tenantId: "platform",
          occurredAt: Date.parse(RECEIVED_AT),
          instanceId: "install-1",
          event: "daily_usage_stats",
          properties: { version: "3.1.0" },
          unknownFields: 1,
        },
      ]);
    });

    it("keeps a schema version 4 report's ops health as a known field", async () => {
      recorded.length = 0;
      const opsHealth = {
        snapshot_at: "2026-09-29T11:59:00.000Z",
        failed_jobs_total: 4,
        queues: { "event-sourcing": { pending_jobs: 7, dead_letters: 2 } },
        pipelines: null,
        migrations: {},
      };
      const { receiver, facts } = setup();

      await receiver.receive(report({ report_schema_version: 4, ops_health: opsHealth }));

      expect(recorded[0]).toMatchObject({
        properties: { report_schema_version: 4, ops_health: opsHealth },
        unknownFields: 0,
      });
      expect(facts[0]).toMatchObject({ properties: { ops_health: opsHealth }, unknownFields: 0 });
    });

    /** @scenario "A report the registry cannot store is still accepted" */
    /** @scenario "Storage failing never refuses the report" */
    it("answers the report and logs when the registry fails", async () => {
      const { receiver, facts, lines } = setup({
        recordUsageReport: () => Promise.reject(new Error("registry down")),
      });

      await expect(receiver.receive(report())).resolves.toEqual({ message: "Event captured" });
      expect(facts).toHaveLength(1);
      expect(lines.findLine("error", "not recorded in the install registry")).toBeDefined();
    });

    /** @scenario "A report whose fact cannot be recorded is still accepted" */
    it("answers the report and logs when the fact is not recorded", async () => {
      const { receiver, lines } = setup({ failFacts: true });

      await expect(receiver.receive(report())).resolves.toEqual({ message: "Event captured" });
      expect(lines.findLine("error", "its fact was not recorded")).toBeDefined();
    });
  });

  describe("when Cloud names the latest release and the floor", () => {
    /** @scenario "Cloud's answer names the latest release with its commit, and the floor" */
    it("answers with the release, its commit and the floor", async () => {
      const { receiver } = setup({
        release: {
          latestRelease: "3.21.0",
          latestReleaseCommit: "0a1b2c3d",
          releaseFloor: "3.20.1",
        },
      });

      await expect(receiver.receive(report())).resolves.toEqual({
        message: "Event captured",
        latest_release: { release: "3.21.0", commit: "0a1b2c3d" },
        floor: "3.20.1",
      });
    });
  });

  describe("when Cloud names no release", () => {
    /** @scenario "Cloud names no release when none is configured" */
    it("answers exactly as before", async () => {
      const { receiver } = setup();

      await expect(receiver.receive(report())).resolves.toEqual({ message: "Event captured" });
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
      const { receiver, facts } = setup({ rateLimits: limiterRefusing(key) });

      await expect(receiver.receive(report())).rejects.toMatchObject({ code: "rate_limited" });
      expect(recorded).toEqual([]);
      expect(facts).toEqual([]);
    });

    it("counts no per-address bucket where the sender named no address", async () => {
      const limiter = limiterRefusing();
      const { receiver } = setup({ rateLimits: limiter });

      await receiver.receive({ ...report(), addressHeaders: {} });

      expect(limiter.asked).toEqual(["track_usage:global", "track_usage:instance:install-1"]);
    });
  });

  describe("when the deployment is not LangWatch Cloud", () => {
    /** @scenario "Any other deployment refuses Cloud's routes by code" */
    it("refuses before counting, recording or sending anything", async () => {
      recorded.length = 0;
      const limiter = limiterRefusing();
      const { receiver, facts } = setup({ isSaas: false, rateLimits: limiter });

      await expect(receiver.receive(report())).rejects.toMatchObject({
        code: "langwatch_cloud_only",
      });
      expect(limiter.asked).toEqual([]);
      expect(recorded).toEqual([]);
      expect(facts).toEqual([]);
    });
  });
});
