/** Spec: modules/trace/specs/trace-agent-traffic.feature */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { MemoryTraceAgentTrafficRepository } from "../../memory/memory.trace-agent-traffic.repository.ts";
import { TraceAgentTrafficClickHouseRepository } from "../trace-agent-traffic.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

function createRepository(rows: unknown[]) {
  const reads: ReadRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async read(request: ReadRequest) {
      reads.push(request);
      return { rows };
    },
  });
  return { reads, repository: TraceAgentTrafficClickHouseRepository.create(clickhouse) };
}

describe("TraceAgentTrafficClickHouseRepository", () => {
  describe("when the agents seen in a window are read", () => {
    /** @scenario Distinct agent names are read from the project's spans in the window */
    it("asks stored spans for the tenant by start time and answers one row per agent", async () => {
      const { reads, repository } = createRepository([
        {
          agentName: "planner",
          agentId: "agent-7",
          model: "gpt-5-mini",
          spanCount: "12",
          firstSeenMs: "1000",
          lastSeenMs: "5000",
        },
        {
          agentName: "researcher",
          agentId: "",
          model: "",
          spanCount: 3,
          firstSeenMs: 2000,
          lastSeenMs: 2500,
        },
      ]);

      const seen = await repository.findAgentsSeen({
        tenantId: "project-1",
        sinceMs: 1_000,
        limit: 50,
      });

      expect(seen).toEqual([
        {
          agentName: "planner",
          agentId: "agent-7",
          model: "gpt-5-mini",
          spanCount: 12,
          firstSeenMs: 1000,
          lastSeenMs: 5000,
        },
        {
          agentName: "researcher",
          agentId: null,
          model: null,
          spanCount: 3,
          firstSeenMs: 2000,
          lastSeenMs: 2500,
        },
      ]);
      const statement = reads[0]?.statement;
      expect(reads[0]?.table).toBe("stored_spans");
      expect(statement?.kind).toBe("tenant");
      expect(statement?.identity).toBe("reader");
      expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
      expect(statement?.sql).toMatch(
        /WHERE TenantId = \{tenantId:String\} AND \(StartTime >= fromUnixTimestamp64Milli\(/,
      );
      expect(statement?.sql).toMatch(
        /GROUP BY agentName ORDER BY spanCount DESC, agentName ASC LIMIT 50$/,
      );
      expect(Object.values(statement?.params ?? {})).toEqual(
        expect.arrayContaining(["project-1", 1_000]),
      );
    });
  });
});

describe("MemoryTraceAgentTrafficRepository", () => {
  describe("when spans fall outside the window or name no agent", () => {
    /** @scenario Spans outside the window or without an agent name are not counted */
    it("answers no agent", async () => {
      const repository = MemoryTraceAgentTrafficRepository.create();
      repository.record({ tenantId: "project-1", startTimeMs: 500, agentName: "planner" });
      repository.record({ tenantId: "project-1", startTimeMs: 1_500, agentName: "" });
      repository.record({ tenantId: "project-2", startTimeMs: 1_500, agentName: "other" });

      await expect(
        repository.findAgentsSeen({ tenantId: "project-1", sinceMs: 1_000, limit: 10 }),
      ).resolves.toEqual([]);
    });
  });

  describe("when an agent's spans mix models and carry empty values", () => {
    /** @scenario The in-memory twin picks the most-used id and model like the stored read */
    it("answers the id and model on most spans", async () => {
      const repository = MemoryTraceAgentTrafficRepository.create();
      const span = { tenantId: "project-1", agentName: "planner" };
      repository.record({ ...span, startTimeMs: 1_100, agentId: "agent-7", model: "gpt-5" });
      repository.record({ ...span, startTimeMs: 1_200, agentId: "agent-7", model: "gpt-5" });
      repository.record({ ...span, startTimeMs: 1_300, agentId: "agent-8", model: "gpt-5-mini" });
      repository.record({ ...span, startTimeMs: 1_400, agentId: "", model: "" });

      const [seen] = await repository.findAgentsSeen({
        tenantId: "project-1",
        sinceMs: 1_000,
        limit: 10,
      });

      expect(seen).toMatchObject({ agentId: "agent-7", model: "gpt-5", spanCount: 4 });
    });
  });

  describe("when agents tie on span count", () => {
    /** @scenario The in-memory twin orders tied agent names by bytes like the stored read */
    it("orders their names by UTF-8 bytes, not by locale", async () => {
      const repository = MemoryTraceAgentTrafficRepository.create();
      for (const agentName of ["beta", "Ärger", "Zeta"]) {
        repository.record({ tenantId: "project-1", startTimeMs: 1_100, agentName });
      }

      const seen = await repository.findAgentsSeen({
        tenantId: "project-1",
        sinceMs: 1_000,
        limit: 10,
      });

      expect(seen.map((agent) => agent.agentName)).toEqual(["Zeta", "beta", "Ärger"]);
    });
  });
});
