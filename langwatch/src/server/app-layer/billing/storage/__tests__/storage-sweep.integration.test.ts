import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";
import { PrismaStorageSweepCursorRepository } from "../repositories/storage-sweep-cursor.prisma.repository";
import {
  type StorageSweepDeps,
  StorageSweepService,
} from "../storageSweep.service";

const HOUR_MS = 60 * 60 * 1000;

// The sweep cursor is a platform singleton row. Each test deletes it and
// sweeps at its own fixed instant, so claims are deterministic regardless of
// what earlier tests or earlier suite runs left behind (fileParallelism is
// off for integration tests, so nothing races the reset).
let hourCounter = 0;
const runBase = Date.UTC(2031, 0, 1);
function nextSweepInstant(): Date {
  hourCounter += 24; // a fresh day per test so entry-day claims are fresh too
  return new Date(runBase + hourCounter * HOUR_MS + 25 * 60 * 1000);
}

function makeSweep({
  organizationIds,
  meteringEnabled = async () => true,
  failFor = new Set<string>(),
}: {
  organizationIds: string[];
  meteringEnabled?: (organizationId: string) => Promise<boolean>;
  failFor?: Set<string>;
}) {
  const calls = {
    measured: [] as string[],
    exited: [] as string[],
    sampled: [] as string[],
    failures: [] as string[],
  };
  const deps: StorageSweepDeps = {
    cursor: new PrismaStorageSweepCursorRepository(prisma),
    listBillableOrganizationIds: async () => organizationIds,
    isMeteringEnabled: meteringEnabled,
    measurement: {
      measureEntriesForOrg: vi.fn(async ({ organizationId }) => {
        if (failFor.has(organizationId)) throw new Error("boom");
        calls.measured.push(organizationId);
      }),
    },
    exits: {
      emitExitsDue: vi.fn(async ({ organizationId }) => {
        calls.exited.push(organizationId);
      }),
    },
    sampling: {
      sampleHoursForOrg: vi.fn(async ({ organizationId }) => {
        calls.sampled.push(organizationId);
      }),
    },
    onOrgFailure: ({ organizationId }) => {
      calls.failures.push(organizationId);
    },
    now: () => sweepInstant,
  };
  return { service: new StorageSweepService(deps), calls, deps };
}

let sweepInstant: Date;

beforeEach(async () => {
  sweepInstant = nextSweepInstant();
  await prisma.storageSweepCursor.deleteMany({
    where: { id: "storage-sweep" },
  });
});

describe("StorageSweepService", () => {
  describe("when the sealed hour was already swept", () => {
    /** @scenario The sweep runs once per sealed hour regardless of ingest volume */
    it("performs no measurement work on any later wake-up in the same hour", async () => {
      const org = `org_sweep_${nanoid(8)}`;
      const { service, calls } = makeSweep({ organizationIds: [org] });

      await service.sweep();
      // A burst of redundant wake-ups within the same hour.
      for (let i = 0; i < 25; i++) await service.sweep();

      expect(calls.sampled).toEqual([org]);
      expect(calls.measured).toEqual([org]);
    });

    /** @scenario The once-per-hour guarantee survives a process restart */
    it("stays a no-op from a freshly constructed service (durable cursor, not memory)", async () => {
      const org = `org_sweep_${nanoid(8)}`;
      const first = makeSweep({ organizationIds: [org] });
      await first.service.sweep();

      // "Restart": a brand-new service instance with brand-new deps.
      const second = makeSweep({ organizationIds: [org] });
      await second.service.sweep();

      expect(first.calls.sampled).toEqual([org]);
      expect(second.calls.sampled).toEqual([]);
    });
  });

  describe("when several billable organizations exist and only one ingests", () => {
    /** @scenario Ingest from any organization triggers measurement for all billable organizations */
    it("samples every billable organization, idle ones included", async () => {
      const orgs = [`org_a_${nanoid(6)}`, `org_b_idle_${nanoid(6)}`];
      const { service, calls } = makeSweep({ organizationIds: orgs });

      // The wake-up came from org_a's ingest — the sweep doesn't care.
      await service.sweep();

      expect(calls.sampled).toEqual(orgs);
    });
  });

  describe("when one organization fails during measurement", () => {
    /** @scenario A failing organization does not block the rest of the sweep */
    it("alarms the failure and processes the other organizations normally", async () => {
      const orgs = [
        `org_ok1_${nanoid(6)}`,
        `org_poison_${nanoid(6)}`,
        `org_ok2_${nanoid(6)}`,
      ];
      const { service, calls } = makeSweep({
        organizationIds: orgs,
        failFor: new Set([orgs[1]!]),
      });

      await service.sweep();

      expect(calls.sampled).toEqual([orgs[0], orgs[2]]);
      expect(calls.failures).toEqual([orgs[1]]);
    });
  });

  describe("when the metering flag is off", () => {
    /** @scenario With the metering flag off the engine stays fully dark */
    it("produces no measurements, exits, or hourly samples for the org", async () => {
      const org = `org_dark_${nanoid(8)}`;
      const { service, calls } = makeSweep({
        organizationIds: [org],
        meteringEnabled: async () => false,
      });

      await service.sweep();

      expect(calls.measured).toEqual([]);
      expect(calls.exited).toEqual([]);
      expect(calls.sampled).toEqual([]);
    });
  });
});
