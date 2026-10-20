/**
 * @vitest-environment node
 * The thread trace id read: one statement over trace_summaries' keys, fenced to the
 * proof's project.
 * Spec: modules/trace/specs/trace-read-service.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";
import { fencedOver } from "./support/legacy-trace-mapping.support.ts";

const PROJECT_ID = "project-1";

type Statement = { query: string; query_params?: Record<string, unknown> };

describe("TraceLegacyReadClickHouseRepository.findTraceIdsByThreadIds", () => {
  describe("when a caller asks for the trace ids of two threads", () => {
    /** @scenario "A thread trace id read runs one keys-only statement" */
    it("runs one fenced keys-only statement and groups its rows by thread", async () => {
      const query = vi.fn(async (_statement: Statement) => ({
        json: async (): Promise<unknown[]> => [
          { ThreadId: "thread-a", TraceId: "trace-1" },
          { ThreadId: "thread-b", TraceId: "trace-2" },
          { ThreadId: "thread-a", TraceId: "trace-3" },
        ],
      }));
      const repository = TraceLegacyReadClickHouseRepository.create({
        clickhouse: fencedOver(async () => createApiFixture<TraceClickHouseClient>({ query })),
      });

      const result = await repository.findTraceIdsByThreadIds({
        authorization: ownProof({ projectId: PROJECT_ID }),
        projectId: PROJECT_ID,
        threadIds: ["thread-a", "thread-b"],
        maxTraces: 50,
      });

      expect(result).toEqual([
        { threadId: "thread-a", traceIds: ["trace-1", "trace-3"] },
        { threadId: "thread-b", traceIds: ["trace-2"] },
      ]);
      const statements = query.mock.calls.map(([statement]) => statement);
      expect(statements).toHaveLength(1);
      const [statement] = statements;
      expect(statement?.query).toContain("FROM trace_summaries");
      expect(statement?.query).not.toMatch(/ComputedInput|ComputedOutput|stored_spans/);
      expect(statement?.query_params).toMatchObject({
        threadIds: ["thread-a", "thread-b"],
        maxTraces: 50,
        tenantScope_own: [PROJECT_ID],
      });
    });
  });

  describe("when no thread is asked for", () => {
    it("answers nothing without a statement", async () => {
      const query = vi.fn();
      const repository = TraceLegacyReadClickHouseRepository.create({
        clickhouse: fencedOver(async () => createApiFixture<TraceClickHouseClient>({ query })),
      });

      const result = await repository.findTraceIdsByThreadIds({
        authorization: ownProof({ projectId: PROJECT_ID }),
        projectId: PROJECT_ID,
        threadIds: [],
      });

      expect(result).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });
  });
});
