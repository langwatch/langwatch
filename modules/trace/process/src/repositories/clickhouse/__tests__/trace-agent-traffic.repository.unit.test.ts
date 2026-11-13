/** Spec: modules/trace/specs/trace-agent-traffic.feature */
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { MemoryTraceAgentTrafficRepository } from "../../memory/memory.trace-agent-traffic.repository.ts";
import { TraceAgentTrafficClickHouseRepository } from "../trace-agent-traffic.repository.ts";

function createRepository(rows: unknown[]) {
  const queries: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    async query(request: QueryRequest): Promise<{ rows: unknown[] }> {
      queries.push(request);
      return { rows };
    },
  });
  return { queries, repository: TraceAgentTrafficClickHouseRepository.create(clickhouse) };
}

describe("TraceAgentTrafficClickHouseRepository", () => {
  describe("when the agents seen in a window are read", () => {
    /** @scenario Distinct agent names are read from the project's spans in the window */
    it("asks stored spans for the tenant by start time and answers one row per agent", async () => {
      const { queries, repository } = createRepository([
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
      expect(queries[0]?.tenantId).toBe("project-1");
      expect(queries[0]?.table).toBe("stored_spans");
      expect(queries[0]?.sql).toMatch(
        /WHERE TenantId = \{tenantId:String\}\s+AND StartTime >= fromUnixTimestamp64Milli/,
      );
      expect(queries[0]?.params).toEqual({ tenantId: "project-1", since: 1_000, limit: 50 });
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

  describe("when an agent's spans carry an empty id or model before a real one", () => {
    /** @scenario The in-memory twin skips empty ids and models like the stored read */
    it("answers the latest non-empty id and model", async () => {
      const repository = MemoryTraceAgentTrafficRepository.create();
      const span = { tenantId: "project-1", agentName: "planner" };
      repository.record({ ...span, startTimeMs: 1_100, agentId: "agent-7", model: "gpt-5" });
      repository.record({ ...span, startTimeMs: 1_200, agentId: "", model: "" });

      const [seen] = await repository.findAgentsSeen({
        tenantId: "project-1",
        sinceMs: 1_000,
        limit: 10,
      });

      expect(seen).toMatchObject({ agentId: "agent-7", model: "gpt-5", spanCount: 2 });
    });
  });
});
