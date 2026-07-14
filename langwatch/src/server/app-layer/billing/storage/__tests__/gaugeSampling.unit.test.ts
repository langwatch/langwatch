import { describe, expect, it, vi } from "vitest";

import { GaugeSamplingService } from "../gaugeSampling.service";
import type { StoredBoundaryEvent } from "../repositories/storage-boundary-event.repository";
import type { HourlySample } from "../repositories/storage-usage-hourly.repository";

const HOUR_MS = 60 * 60 * 1000;
const at = new Date(Date.UTC(2026, 6, 10, 14, 30));
const sealed = new Date(Date.UTC(2026, 6, 10, 13));

function makeService({
  events = [],
  lastSampled = null,
}: {
  events?: Partial<StoredBoundaryEvent>[];
  lastSampled?: Date | null;
}) {
  const recorded: HourlySample[] = [];
  const alarms: unknown[] = [];
  const service = new GaugeSamplingService({
    events: {
      append: vi.fn(),
      findAllByOrganization: vi.fn(async () => events as StoredBoundaryEvent[]),
      sumNonExitByPartition: vi.fn(async () => []),
      sumLiveNetGroups: vi.fn(async () => []),
      // Force the replay path in unit tests — the O(1) fast path is proven
      // in the integration suite against real repositories.
      countEventsAfter: vi.fn(async () => 1),
    },
    gauge: { findByOrganization: vi.fn(async () => null) },
    usageHourly: {
      getLastSampledHour: vi.fn(async () => lastSampled),
      recordHours: vi.fn(async ({ rows }) => {
        recorded.push(...rows);
      }),
    },
    onDriftAlarm: (params) => {
      alarms.push(params);
    },
  });
  return { service, recorded, alarms };
}

describe("GaugeSamplingService", () => {
  describe("when the gauge folded to a small negative value", () => {
    /** @scenario The sampled hourly value is never negative */
    it("records zero megabytes", async () => {
      const { service, recorded, alarms } = makeService({
        events: [{ occurredAt: new Date(0), deltaBytes: -1024n }],
        lastSampled: new Date(sealed.getTime() - HOUR_MS),
      });
      await service.sampleHoursForOrg({ organizationId: "org_1", at });

      expect(recorded).toEqual([{ sealedHour: sealed, megabytes: 0 }]);
      expect(alarms).toEqual([]); // small dip = merge noise, no alarm
    });
  });

  describe("when nothing new is sealed", () => {
    it("does nothing", async () => {
      const { service, recorded } = makeService({ lastSampled: sealed });
      await service.sampleHoursForOrg({ organizationId: "org_1", at });
      expect(recorded).toEqual([]);
    });
  });

  describe("when the org has never been sampled", () => {
    it("starts forward-only at the latest sealed hour", async () => {
      const { service, recorded } = makeService({
        events: [{ occurredAt: new Date(0), deltaBytes: 5n * 1024n * 1024n }],
      });
      await service.sampleHoursForOrg({ organizationId: "org_1", at });

      expect(recorded).toEqual([{ sealedHour: sealed, megabytes: 5 }]);
    });
  });

  describe("when the sampled bytes are not a whole MiB", () => {
    it("rounds up", async () => {
      const { service, recorded } = makeService({
        events: [{ occurredAt: new Date(0), deltaBytes: 1024n * 1024n + 1n }],
        lastSampled: new Date(sealed.getTime() - HOUR_MS),
      });
      await service.sampleHoursForOrg({ organizationId: "org_1", at });
      expect(recorded[0]!.megabytes).toEqual(2);
    });
  });
});
