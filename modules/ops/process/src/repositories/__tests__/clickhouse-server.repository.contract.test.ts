/**
 * @vitest-environment node
 * The shared ClickHouse's failed statement groups and health as ops reads them, stated once
 * and run against the memory twin; the ClickHouse read has its own integration suite.
 */
import { describe, expect, it } from "vitest";

import type {
  ClickHouseQueryErrorRow,
  ClickHouseServerRepository,
} from "../clickhouse.server.repository.ts";
import { MemoryClickHouseServerRepository } from "../memory/memory.clickhouse-server.repository.ts";

const SINCE = 1_800_000_000_000;
const UNTIL = SINCE + 60 * 60 * 1000;

type Backend = Readonly<{
  name: string;
  given: (rows: readonly ClickHouseQueryErrorRow[]) => ClickHouseServerRepository;
}>;

const backends: readonly Backend[] = [
  {
    name: "memory",
    given: (rows) => {
      const repository = MemoryClickHouseServerRepository.create();
      repository.errors = [...rows];
      return repository;
    },
  },
];

function group(
  overrides: Partial<ClickHouseQueryErrorRow> & { queryShapeId: string },
): ClickHouseQueryErrorRow {
  return {
    source: "lwql",
    code: 241,
    codeName: "MEMORY_LIMIT_EXCEEDED",
    count: 1,
    p95Ms: 120,
    maxMemoryBytes: 10_000_000,
    rowsRead: 2,
    projectIds: ["project-1"],
    lastAt: SINCE + 1_000,
    ...overrides,
  };
}

function shapes(rows: readonly ClickHouseQueryErrorRow[]): string[] {
  return rows.map((row) => row.queryShapeId).toSorted();
}

describe.each(backends)("given the $name ClickHouse server repository", ({ given }) => {
  describe("when failed statements are read (findQueryErrors)", () => {
    it("answers each group with its source, code, count and projects", async () => {
      const lwql = group({ queryShapeId: "101" });
      const dashboard = group({
        queryShapeId: "202",
        source: "dashboard",
        code: 47,
        codeName: "UNKNOWN_IDENTIFIER",
        projectIds: [],
      });
      const repository = given([lwql, dashboard]);

      const groups = await repository.findQueryErrors({ sinceMs: SINCE, untilMs: UNTIL });

      expect(groups.find((row) => row.projectIds.includes("project-1"))).toEqual(lwql);
      expect(groups.find((row) => row.source === "dashboard")).toEqual(dashboard);
    });

    it("keeps a group last seen exactly at since, never one last seen at until", async () => {
      const repository = given([
        group({ queryShapeId: "at-since", lastAt: SINCE }),
        group({ queryShapeId: "before-since", lastAt: SINCE - 1 }),
        group({ queryShapeId: "at-until", lastAt: UNTIL }),
      ]);

      const groups = await repository.findQueryErrors({ sinceMs: SINCE, untilMs: UNTIL });

      expect(shapes(groups)).toEqual(["at-since"]);
    });

    it("narrows to one error code and to one source when asked", async () => {
      const repository = given([
        group({ queryShapeId: "lwql-memory" }),
        group({ queryShapeId: "lwql-timeout", code: 159, codeName: "TIMEOUT_EXCEEDED" }),
        group({ queryShapeId: "dashboard-memory", source: "dashboard" }),
        group({ queryShapeId: "other-memory", source: "other" }),
      ]);
      const window = { sinceMs: SINCE, untilMs: UNTIL };

      expect(shapes(await repository.findQueryErrors({ ...window, code: 159 }))).toEqual([
        "lwql-timeout",
      ]);
      expect(shapes(await repository.findQueryErrors({ ...window, source: "dashboard" }))).toEqual([
        "dashboard-memory",
      ]);
      expect(
        shapes(await repository.findQueryErrors({ ...window, code: 241, source: "lwql" })),
      ).toEqual(["lwql-memory"]);
      expect(shapes(await repository.findQueryErrors({ ...window, source: "other" }))).toEqual([
        "other-memory",
      ]);
    });

    it("answers no groups when nothing failed", async () => {
      await expect(given([]).findQueryErrors({ sinceMs: SINCE, untilMs: UNTIL })).resolves.toEqual(
        [],
      );
    });
  });

  describe("when the server's health is read (findHealth)", () => {
    it("answers at least one node and a free ratio between zero and one", async () => {
      const health = await given([]).findHealth({});

      expect(health.nodes).toBeGreaterThanOrEqual(1);
      expect(health.disks.lowestFreeRatio).toBeGreaterThanOrEqual(0);
      expect(health.disks.lowestFreeRatio).toBeLessThanOrEqual(1);
    });
  });
});
