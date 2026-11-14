// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * Each activity-monitor ClickHouse read is a built read (ADR-202) scoped to the governance
 * project it names, sent on the reader identity with that tenant as its setting.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { PrismaActivityMonitorRepository } from "../prisma.ingestion-source-activity.repository.ts";

const TENANT = "governance-project";

function recordingRepository() {
  const statements: ReaderReadStatement[] = [];
  const client = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows: [] };
    },
    insert: async () => undefined,
  };
  const repository = PrismaActivityMonitorRepository.create({
    prisma: {} as never,
    clickhouse: async () => client as never,
  });
  return { repository, statements };
}

const COMMON = { organizationId: "org-a", tenantId: TENANT };

describe("the activity monitor's ClickHouse reads as built reads", () => {
  describe("when each read is sent", () => {
    it.each([
      {
        name: "the logged and pulled counts by source",
        reads: 2,
        run: (r: PrismaActivityMonitorRepository) =>
          r.countLoggedAndPulledEventsBySource({ ...COMMON, sourceIds: ["s-1"], sinceMs: 1 }),
      },
      {
        name: "a source's pulled events",
        reads: 1,
        run: (r: PrismaActivityMonitorRepository) =>
          r.findPulledEventsForSource({ ...COMMON, sourceId: "s-1", beforeMs: 2, limit: 5 }),
      },
      {
        name: "the logged and pulled event windows",
        reads: 2,
        run: (r: PrismaActivityMonitorRepository) =>
          r.findLoggedAndPulledEventWindows({
            ...COMMON,
            sourceId: "s-1",
            since24h: 3,
            since7d: 2,
            since30d: 1,
          }),
      },
    ])("sends $name scoped to the one tenant it names, on the reader", async (read) => {
      const { repository, statements } = recordingRepository();

      await read.run(repository);

      expect(statements).toHaveLength(read.reads);
      for (const statement of statements) {
        expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: TENANT });
        expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: TENANT });
        expect(statement.sql).not.toContain(TENANT);
      }
    });
  });

  describe("when no source is asked for", () => {
    it("sends no count read", async () => {
      const { repository, statements } = recordingRepository();

      const counts = await repository.countLoggedAndPulledEventsBySource({
        ...COMMON,
        sourceIds: [],
        sinceMs: 1,
      });

      expect(counts).toEqual([]);
      expect(statements).toEqual([]);
    });
  });
});
