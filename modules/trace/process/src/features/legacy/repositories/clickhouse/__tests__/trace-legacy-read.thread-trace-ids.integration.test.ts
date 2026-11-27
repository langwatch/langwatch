/**
 * The thread trace id read against the migrated schema: each thread answers its own trace ids,
 * once each, oldest first.
 * Spec: modules/trace/specs/trace-read-service.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { authorizedClickHouseFor } from "../../../../../repositories/clickhouse/__tests__/support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `test-thread-ids-${nanoid()}`;
const baseMs = Date.now() - 60 * 60 * 1000;
const THREAD_A = `thread-a-${nanoid()}`;
const THREAD_B = `thread-b-${nanoid()}`;

function summaryRow({
  traceId,
  threadId,
  occurredAtMs,
  updatedAtMs = occurredAtMs,
}: {
  traceId: string;
  threadId: string;
  occurredAtMs: number;
  updatedAtMs?: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: { "gen_ai.conversation.id": threadId },
    OccurredAt: new Date(occurredAtMs),
    CreatedAt: new Date(occurredAtMs),
    UpdatedAt: new Date(updatedAtMs),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: null,
    ComputedOutput: null,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 0,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    SatisfactionScore: null,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

let ch: ClickHouseClient;
let repository: TraceLegacyReadClickHouseRepository;

describe.skipIf(!clickHouseConfigured)(
  "TraceLegacyReadClickHouseRepository.findTraceIdsByThreadIds (integration)",
  () => {
    beforeAll(async () => {
      ch = await startMigratedTraceClickHouse();
      repository = TraceLegacyReadClickHouseRepository.create({
        clickhouse: authorizedClickHouseFor(ch),
      });
      await ch.insert({
        table: "trace_summaries",
        values: [
          summaryRow({ traceId: "trace-a-late", threadId: THREAD_A, occurredAtMs: baseMs + 2_000 }),
          summaryRow({ traceId: "trace-a-early", threadId: THREAD_A, occurredAtMs: baseMs }),
          summaryRow({
            traceId: "trace-a-early",
            threadId: THREAD_A,
            occurredAtMs: baseMs,
            updatedAtMs: baseMs + 5_000,
          }),
          summaryRow({ traceId: "trace-b-only", threadId: THREAD_B, occurredAtMs: baseMs + 1_000 }),
          summaryRow({
            traceId: "trace-elsewhere",
            threadId: "thread-other",
            occurredAtMs: baseMs,
          }),
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    }, 60_000);

    afterAll(async () => {
      if (ch) {
        await ch.exec({
          query: `ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}`,
          query_params: { tenantId },
        });
      }
    });

    describe("when a caller reads both threads' trace ids", () => {
      /** @scenario "A thread trace id read answers each thread's ids, oldest first" */
      it("answers each thread's own trace ids once each, oldest first", async () => {
        const result = await repository.findTraceIdsByThreadIds({
          authorization: ownProof({ projectId: tenantId }),
          projectId: tenantId,
          threadIds: [THREAD_A, THREAD_B],
        });

        expect(result.toSorted((a, b) => a.threadId.localeCompare(b.threadId))).toEqual([
          { threadId: THREAD_A, traceIds: ["trace-a-early", "trace-a-late"] },
          { threadId: THREAD_B, traceIds: ["trace-b-only"] },
        ]);
      });
    });
  },
);
