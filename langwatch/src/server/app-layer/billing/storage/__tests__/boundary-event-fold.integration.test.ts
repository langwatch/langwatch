import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { foldBoundaryEvents } from "../gaugeFold";
import { PrismaStorageBillableGaugeRepository } from "../repositories/storage-billable-gauge.prisma.repository";
import { PrismaStorageBoundaryEventRepository } from "../repositories/storage-boundary-event.prisma.repository";

const GIB = 1024n * 1024n * 1024n;

describe("PrismaStorageBoundaryEventRepository", () => {
  const organizationId = `org_test_fold_${nanoid(8)}`;
  const events = new PrismaStorageBoundaryEventRepository(prisma);
  const gauge = new PrismaStorageBillableGaugeRepository(prisma);

  const base = {
    organizationId,
    projectId: "project_1",
    category: "traces",
    partitionKey: "202620",
    retentionDays: 63,
  } as const;

  const day = (n: number) => new Date(Date.UTC(2026, 4, n));

  afterAll(async () => {
    await prisma.storageBoundaryEvent.deleteMany({
      where: { organizationId },
    });
    await prisma.storageBillableGauge.deleteMany({
      where: { organizationId },
    });
  });

  describe("given a mix of entries, a replay, an exit, and a keyed correction", () => {
    beforeAll(async () => {
      // Two entry slices age past the billable line.
      await events.append({
        ...base,
        sliceDate: day(1),
        edge: "ENTRY",
        deltaBytes: 12n * GIB,
        occurredAt: day(5),
      });
      await events.append({
        ...base,
        sliceDate: day(2),
        edge: "ENTRY",
        deltaBytes: 15n * GIB,
        occurredAt: day(6),
      });
      // A crashed emitter re-delivers the first entry.
      await events.append({
        ...base,
        sliceDate: day(1),
        edge: "ENTRY",
        deltaBytes: 12n * GIB,
        occurredAt: day(5),
      });
      // The first slice reaches retention and exits (mirror, negated).
      await events.append({
        ...base,
        sliceDate: day(1),
        edge: "EXIT",
        deltaBytes: -12n * GIB,
        occurredAt: day(10),
      });
      // A retention change reverses the second slice and re-emits it
      // under the new retention, both keyed by the change id.
      await events.append({
        ...base,
        sliceDate: day(2),
        edge: "REVERSAL",
        deltaBytes: -15n * GIB,
        occurredAt: day(12),
        causeId: "change_1",
      });
      await events.append({
        ...base,
        sliceDate: day(2),
        retentionDays: 91,
        edge: "ENTRY",
        deltaBytes: 15n * GIB,
        occurredAt: day(12),
        causeId: "change_1",
      });
    });

    describe("when all events are folded from scratch", () => {
      /** @scenario Folding the full event log reproduces the gauge row */
      it("reproduces the stored gauge value", async () => {
        const log = await events.findAllByOrganization({ organizationId });
        const foldedFromScratch = foldBoundaryEvents({
          initialBytes: 0n,
          events: log,
        });

        const gaugeRow = await gauge.findByOrganization({ organizationId });
        expect(gaugeRow?.billableBytes).toEqual(foldedFromScratch);
      });

      it("holds 15 GiB after entries, replay no-op, exit, and re-booked retention", () => {
        return gauge
          .findByOrganization({ organizationId })
          .then((row) => expect(row?.billableBytes).toEqual(15n * GIB));
      });

      it("stored the replayed entry exactly once", async () => {
        const log = await events.findAllByOrganization({ organizationId });
        expect(log).toHaveLength(5);
      });
    });

    describe("when a replayed event is appended", () => {
      it("reports applied: false and changes nothing", async () => {
        const replay = await events.append({
          ...base,
          sliceDate: day(1),
          edge: "ENTRY",
          deltaBytes: 12n * GIB,
          occurredAt: day(5),
        });
        expect(replay.applied).toBe(false);
      });
    });
  });
});
