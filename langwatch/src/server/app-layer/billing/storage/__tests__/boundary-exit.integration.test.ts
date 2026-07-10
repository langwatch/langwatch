import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { BoundaryExitService } from "../boundaryExit.service";
import { PrismaStorageBillableGaugeRepository } from "../repositories/storage-billable-gauge.prisma.repository";
import { PrismaStorageBoundaryEventRepository } from "../repositories/storage-boundary-event.prisma.repository";

const GIB = 1024n * 1024n * 1024n;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("BoundaryExitService", () => {
  const organizationId = `org_test_exit_${nanoid(8)}`;
  const events = new PrismaStorageBoundaryEventRepository(prisma);
  const gauge = new PrismaStorageBillableGaugeRepository(prisma);
  const service = new BoundaryExitService({ events });

  const sliceDate = new Date(Date.UTC(2026, 4, 1));
  const base = {
    organizationId,
    projectId: "project_1",
    category: "traces",
    partitionKey: "2026-04-26",
    sliceDate,
    retentionDays: 63,
  } as const;

  beforeAll(async () => {
    await events.append({
      ...base,
      edge: "ENTRY",
      deltaBytes: 3n * GIB,
      occurredAt: new Date(sliceDate.getTime() + 35 * DAY_MS),
    });
  });

  afterAll(async () => {
    await prisma.storageBoundaryEvent.deleteMany({ where: { organizationId } });
    await prisma.storageBillableGauge.deleteMany({ where: { organizationId } });
  });

  describe("when the slice reaches its retention age", () => {
    /** @scenario Data reaching its retention age decreases the gauge without a query */
    it("records the mirroring exit and the gauge returns to zero — with no ClickHouse client anywhere in the exit path", async () => {
      await service.emitExitsDue({
        organizationId,
        at: new Date(sliceDate.getTime() + 63 * DAY_MS),
      });

      const log = await events.findAllByOrganization({ organizationId });
      expect(log.map((e) => [e.edge, e.deltaBytes])).toEqual([
        ["ENTRY", 3n * GIB],
        ["EXIT", -3n * GIB],
      ]);

      const row = await gauge.findByOrganization({ organizationId });
      expect(row?.billableBytes).toEqual(0n);

      // The ADR invariant's structural half: the exit module cannot query
      // ClickHouse because it has no ClickHouse dependency at all — no
      // import of any clickhouse module (comments may mention the word).
      const source = fs.readFileSync(
        path.join(__dirname, "../boundaryExit.service.ts"),
        "utf-8",
      );
      const importLines = source
        .split("\n")
        .filter((line) => line.startsWith("import"));
      expect(
        importLines.filter((line) => line.toLowerCase().includes("clickhouse")),
      ).toEqual([]);
    });

    it("does nothing on a second run (the group nets to zero)", async () => {
      await service.emitExitsDue({
        organizationId,
        at: new Date(sliceDate.getTime() + 90 * DAY_MS),
      });
      const log = await events.findAllByOrganization({ organizationId });
      expect(log).toHaveLength(2);
    });
  });

  describe("when the slice is not yet due or never expires", () => {
    it("leaves undue and indefinite-retention groups untouched", async () => {
      const indefiniteOrg = `org_test_exit_inf_${nanoid(8)}`;
      await events.append({
        ...base,
        organizationId: indefiniteOrg,
        retentionDays: 0,
        edge: "ENTRY",
        deltaBytes: 1n * GIB,
        occurredAt: new Date(sliceDate.getTime() + 35 * DAY_MS),
      });
      await service.emitExitsDue({
        organizationId: indefiniteOrg,
        at: new Date(sliceDate.getTime() + 5000 * DAY_MS),
      });

      const log = await events.findAllByOrganization({
        organizationId: indefiniteOrg,
      });
      expect(log.map((e) => e.edge)).toEqual(["ENTRY"]);

      await prisma.storageBoundaryEvent.deleteMany({
        where: { organizationId: indefiniteOrg },
      });
      await prisma.storageBillableGauge.deleteMany({
        where: { organizationId: indefiniteOrg },
      });
    });
  });
});
