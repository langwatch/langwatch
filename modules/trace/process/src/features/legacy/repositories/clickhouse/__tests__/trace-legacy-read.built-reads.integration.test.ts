/**
 * The legacy reads that take no filter, built (ADR-202) and run on a migrated 26.8 server as the
 * reader with the tenant setting: the thread lookups, topic counts, customers and labels, the
 * prompt studio span and field discovery, each against main's rows on 26.8, kept as literals.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  authorizedClickHouseFor,
  traceQueryClientFor,
} from "../../../../../repositories/clickhouse/__tests__/support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `test-legacy-built-${nanoid()}`;
const otherTenantId = `test-legacy-built-other-${nanoid()}`;
const now = Date.now();

function summary({
  tenant = tenantId,
  traceId,
  attributes = {},
  topicId = null,
  createdAt = now,
}: {
  tenant?: string;
  traceId: string;
  attributes?: Record<string, string>;
  topicId?: string | null;
  createdAt?: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    TraceId: traceId,
    Version: "v1",
    Attributes: attributes,
    OccurredAt: new Date(now),
    CreatedAt: new Date(createdAt),
    UpdatedAt: new Date(now),
    TopicId: topicId,
  };
}

function span({
  tenant = tenantId,
  traceId,
  spanId,
  parentSpanId = null,
  name,
  attributes,
}: {
  tenant?: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  attributes: Record<string, string>;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: parentSpanId,
    Sampled: 1,
    StartTime: new Date(now),
    EndTime: new Date(now + 5),
    DurationMs: 5,
    SpanName: name,
    SpanKind: 1,
    ServiceName: "test-service",
    SpanAttributes: attributes,
    StatusCode: 1,
    ScopeName: "test",
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
  };
}

function evaluationRun({
  tenant = tenantId,
  evaluatorId,
  name,
  scheduledAt,
}: {
  tenant?: string;
  evaluatorId: string;
  name: string;
  scheduledAt: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    EvaluationId: `eval-${nanoid()}`,
    Version: "v1",
    EvaluatorId: evaluatorId,
    EvaluatorType: "custom/test",
    EvaluatorName: name,
    TraceId: "trace-p",
    IsGuardrail: 0,
    Status: "processed",
    ScheduledAt: new Date(scheduledAt),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    LastEventOccurredAt: new Date(now),
  };
}

let ch: ClickHouseClient;
let repository: TraceLegacyReadClickHouseRepository;

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repository = TraceLegacyReadClickHouseRepository.create({
    resolveClickHouseClient: async () => ch,
    clickhouse: authorizedClickHouseFor(ch),
    reader: traceQueryClientFor(ch),
  });
  await ch.insert({
    table: "trace_summaries",
    values: [
      summary({
        traceId: "trace-b",
        attributes: { "gen_ai.conversation.id": "thread-1", "langwatch.customer_id": "cust-1" },
        topicId: "topic-1",
        createdAt: now - 1_000,
      }),
      summary({
        traceId: "trace-a",
        attributes: { "gen_ai.conversation.id": "thread-1", "langwatch.labels": '["red"]' },
        topicId: "topic-1",
        createdAt: now - 2_000,
      }),
      summary({
        traceId: "trace-c",
        attributes: { "gen_ai.conversation.id": "thread-2" },
      }),
      summary({
        tenant: otherTenantId,
        traceId: "trace-other",
        attributes: { "gen_ai.conversation.id": "thread-1", "langwatch.customer_id": "cust-x" },
        topicId: "topic-1",
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
  await ch.insert({
    table: "stored_spans",
    values: [
      span({
        traceId: "trace-p",
        spanId: "span-root",
        name: "agent",
        attributes: { "langwatch.prompt.handle": "greeter" },
      }),
      span({
        traceId: "trace-p",
        spanId: "span-llm",
        parentSpanId: "span-root",
        name: "chat",
        attributes: { "langwatch.span.type": "llm", "gen_ai.request.model": "gpt-5" },
      }),
      span({
        tenant: otherTenantId,
        traceId: "trace-p-other",
        spanId: "span-llm",
        name: "other-chat",
        attributes: { "langwatch.span.type": "llm" },
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
  await ch.insert({
    table: "evaluation_runs",
    values: [
      evaluationRun({ evaluatorId: "evaluator-1", name: "Old name", scheduledAt: now - 2_000 }),
      evaluationRun({ evaluatorId: "evaluator-1", name: "Faithfulness", scheduledAt: now - 1_000 }),
      evaluationRun({ evaluatorId: "evaluator-2", name: "Accuracy", scheduledAt: now }),
      evaluationRun({
        tenant: otherTenantId,
        evaluatorId: "evaluator-x",
        name: "Elsewhere",
        scheduledAt: now,
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const table of ["trace_summaries", "stored_spans", "evaluation_runs"]) {
    await ch.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({a:String}, {b:String})`,
      query_params: { a: tenantId, b: otherTenantId },
    });
  }
});

const window = { projectId: tenantId, filters: {}, startDate: now - 60_000, endDate: now + 60_000 };

describe.skipIf(!clickHouseConfigured)("legacy built reads on live ClickHouse", () => {
  describe("when a thread's traces are read through the proof", () => {
    it("finds only the project's traces of that thread", async () => {
      const authorization = ownProof({ projectId: tenantId });

      const one = await repository.findTracesByThreadId({
        authorization,
        projectId: tenantId,
        threadId: "thread-1",
        retentionDays: undefined,
      });
      const many = await repository.findTracesWithSpansByThreadIds({
        authorization,
        projectId: tenantId,
        threadIds: ["thread-1", "thread-2"],
        retentionDays: undefined,
      });

      expect(one.map((trace) => trace.summary.traceId).toSorted()).toEqual(["trace-a", "trace-b"]);
      expect(many.map((trace) => trace.summary.traceId).toSorted()).toEqual([
        "trace-a",
        "trace-b",
        "trace-c",
      ]);
    });
  });

  describe("when the project's topics, customers and labels are read", () => {
    it("counts and lists only the project's own summaries in the window", async () => {
      const topics = await repository.findTopicCounts(window);
      const { customers, labels } = await repository.findCustomersAndLabels(window);

      expect(topics).toEqual({ topicCounts: [{ key: "topic-1", count: 2 }], subtopicCounts: [] });
      expect(customers).toEqual(["cust-1"]);
      expect(labels).toEqual(["red"]);
    });
  });

  describe("when the prompt studio span is read by span id", () => {
    it("derives what main derived, from the project's own trace only", async () => {
      const built = await repository.findSpanForPromptStudio({
        projectId: tenantId,
        spanId: "span-llm",
        protections: { canSeeCosts: true },
      });

      expect(built).not.toBeNull();
      expect(built).toEqual({
        spanId: "span-llm",
        traceId: "trace-p",
        spanName: "chat",
        messages: [],
        llmConfig: {
          model: "gpt-5",
          temperature: null,
          maxTokens: null,
          topP: null,
          frequencyPenalty: null,
          presencePenalty: null,
          seed: null,
          topK: null,
          minP: null,
          repetitionPenalty: null,
          reasoning: null,
          verbosity: null,
          litellmParams: {},
        },
        vendor: null,
        error: null,
        timestamps: { started_at: now, finished_at: now + 5 },
        metrics: null,
        promptHandle: null,
        promptVersionNumber: null,
        promptTag: null,
        promptVariables: null,
      });
    });
  });

  describe("when the project's field names are discovered", () => {
    it("lists span names, metadata keys and evaluators as main did", async () => {
      const fields = await repository.findDistinctFieldNames(
        tenantId,
        window.startDate,
        window.endDate,
      );

      const named = (...keys: string[]) => keys.map((key) => ({ key, label: key }));
      expect(fields).toEqual({
        spanNames: named("agent", "chat"),
        metadataKeys: named("gen_ai.conversation.id", "langwatch.customer_id", "langwatch.labels"),
        evaluationNames: [
          { key: "evaluator-2", label: "Accuracy" },
          { key: "evaluator-1", label: "Faithfulness" },
        ],
      });
    });
  });
});
