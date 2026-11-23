import type { ClickHouseQueryClient, QueryRequest } from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ClickHouseBillableEventsTtlRepository } from "../clickhouse.billable-events-ttl.repository.ts";

/** A ClickHouse that answers every read with `rows`, recording each query and command. */
function repositoryOver(rows: unknown[]) {
  const queries: QueryRequest[] = [];
  const commands: QueryRequest[] = [];
  const repository = ClickHouseBillableEventsTtlRepository.create(
    createApiFixture<ClickHouseQueryClient>({
      query: (async (request: QueryRequest) => {
        queries.push(request);
        return { rows };
      }) as ClickHouseQueryClient["query"],
      command: async (request) => {
        commands.push(request);
      },
    }),
  );
  return { repository, queries, commands };
}

const flat = (sql: string | undefined) => sql?.replace(/\s+/g, " ").trim();

describe("ClickHouseBillableEventsTtlRepository.findTtlMutations", () => {
  describe("given TTL materialisations listed for billable_events", () => {
    it("reads only this database's billable_events TTL mutations, newest first", async () => {
      const { repository, queries } = repositoryOver([]);

      await repository.findTtlMutations();

      expect(queries).toHaveLength(1);
      const sql = flat(queries[0]?.sql);
      expect(sql).toContain("FROM system.mutations");
      expect(sql).toContain("WHERE database = currentDatabase()");
      expect(sql).toContain("AND table = 'billable_events'");
      expect(sql).toContain("AND position(command, 'MATERIALIZE TTL') > 0");
      expect(sql).toContain("ORDER BY create_time DESC");
      expect(queries[0]?.SKIP_TENANT_CHECK).toBe(true);
    });

    it("parses is_done into a boolean and keeps the other fields", async () => {
      const { repository } = repositoryOver([
        { mutationId: "mutation_2", isDone: 0, partsToDo: 3, latestFailReason: "" },
        { mutationId: "mutation_1", isDone: 1, partsToDo: 0, latestFailReason: "disk full" },
      ]);

      await expect(repository.findTtlMutations()).resolves.toEqual([
        { mutationId: "mutation_2", isDone: false, partsToDo: 3, latestFailReason: "" },
        { mutationId: "mutation_1", isDone: true, partsToDo: 0, latestFailReason: "disk full" },
      ]);
    });

    it("refuses a row that is not a mutation", async () => {
      const { repository } = repositoryOver([{ mutationId: "mutation_1" }]);

      await expect(repository.findTtlMutations()).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalid_type", path: [0, "isDone"] }),
        ]),
      });
    });
  });
});

describe("ClickHouseBillableEventsTtlRepository.materialiseTtl", () => {
  describe("when the step starts the materialisation", () => {
    it("issues one whole-table MATERIALIZE TTL on billable_events", async () => {
      const { repository, commands } = repositoryOver([]);

      await repository.materialiseTtl();

      expect(commands).toHaveLength(1);
      expect(commands[0]?.sql).toBe("ALTER TABLE billable_events MATERIALIZE TTL");
      expect(commands[0]?.table).toBe("billable_events");
      expect(commands[0]?.SKIP_TENANT_CHECK).toBe(true);
    });
  });
});
