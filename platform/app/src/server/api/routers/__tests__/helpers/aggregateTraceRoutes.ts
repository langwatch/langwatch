/**
 * The App and the rows the ADR-144 trace route suites share: the real
 * aggregate machinery (rule service, reconciler, grants ledger) over real
 * Postgres, and the trace services over a real ClickHouse through the
 * authorized client. Only what the trace routes do not reach keeps the test
 * App's null defaults.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { HandledError } from "@langwatch/handled-error";
import { nanoid } from "nanoid";
import { NullLwqlKeyMapRepository } from "~/server/analytics/lwql/lwqlKeyMap.repository";
import { globalForApp } from "~/server/app-layer/app";
import {
  GrantsLedgerWriter,
  resetAuthzGrantsCommandsForTests,
} from "~/server/app-layer/authz/ledger";
import { AuthorizedClickHouse } from "~/server/app-layer/clients/clickhouse/authorized-reads";
import { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import { TraceEvaluationsClickHouseRepository } from "~/server/app-layer/evaluations/repositories/trace-evaluations.clickhouse.repository";
import {
  createTestApp,
  type TestAppOverrides,
} from "~/server/app-layer/presets";
import { realOrganizationService } from "~/server/app-layer/projects/__tests__/aggregateProjectFixture";
import { AggregateReconciler } from "~/server/app-layer/projects/aggregate-reconciler.service";
import { AggregateRuleService } from "~/server/app-layer/projects/aggregate-rule.service";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaAggregateReconcileLock } from "~/server/app-layer/projects/repositories/aggregate-reconcile-lock.prisma.repository";
import { PrismaAggregateRuleRepository } from "~/server/app-layer/projects/repositories/aggregate-rule.prisma.repository";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import { PrismaScheduledJobRepository } from "~/server/app-layer/scheduler/scheduled-job.repository";
import { NullTopicRepository } from "~/server/app-layer/topic-clustering/repositories/null-topic.repository";
import { TopicService } from "~/server/app-layer/topic-clustering/topic.service";
import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { TraceListClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-list.clickhouse.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceListService } from "~/server/app-layer/traces/trace-list.service";
import { TraceSummaryService } from "~/server/app-layer/traces/trace-summary.service";
import { prisma } from "~/server/db";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { evaluationRunRepositoryFor } from "~/test-utils/evaluationRunRepository";
import { traceSummaryRepositoryFor } from "~/test-utils/traceSummaryRepository";

/**
 * Installs the App the trace routes read through. `overrides` lands on top,
 * for a suite that also needs a real dependency the defaults leave null.
 */
export function installAggregateTraceApp({
  ch,
  overrides = {},
}: {
  ch: ClickHouseClient;
  overrides?: TestAppOverrides;
}): void {
  const resolveClient = async () => ch;
  const clickhouse = new AuthorizedClickHouse({ resolveClient });
  const evaluationRuns = new EvaluationRunService(
    evaluationRunRepositoryFor({ resolveClient }),
  );
  const ruleRepository = new PrismaAggregateRuleRepository(prisma);
  const rules = new AggregateRuleService(ruleRepository);

  resetAuthzGrantsCommandsForTests();
  const defaults = createTestApp();
  globalForApp.__langwatch_app = createTestApp({
    organizations: realOrganizationService(prisma),
    projects: new ProjectService(
      new PrismaProjectRepository(prisma),
      new NullLwqlKeyMapRepository(),
      {
        rules,
        reconciler: new AggregateReconciler({
          aggregates: ruleRepository,
          lock: new PrismaAggregateReconcileLock(prisma),
          rules,
          ledger: () => new GrantsLedgerWriter(prisma),
          schedule: new PrismaScheduledJobRepository(prisma),
        }),
      },
    ),
    _eventSourcing: createAuthzTestEventSourcing(prisma),
    traces: {
      ...defaults.traces,
      summary: new TraceSummaryService(
        traceSummaryRepositoryFor(resolveClient),
      ),
      list: new TraceListService(
        new TraceListClickHouseRepository(clickhouse),
        evaluationRuns,
        new TopicService(new NullTopicRepository()),
      ),
      spans: new SpanStorageService(
        new SpanStorageClickHouseRepository({ resolveClient, clickhouse }),
      ),
    },
    evaluations: {
      ...defaults.evaluations,
      runs: evaluationRuns,
      traceEvaluations: new TraceEvaluationsClickHouseRepository({
        resolveClient,
        clickhouse,
      }),
    },
    ...overrides,
  });
}

/** The handled code a refusal carries, on the tRPC error or its cause. */
export const handledCodeOf = (error: unknown): string | undefined => {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (HandledError.isHandled(cause)) return cause.code;
  return HandledError.isHandled(error) ? error.code : undefined;
};

/** One `trace_summaries` row, its content naming the tenant that holds it. */
export function summaryRow({
  tenantId,
  traceId,
  occurredAt,
}: {
  tenantId: string;
  traceId: string;
  occurredAt: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: { "service.name": `service-of-${tenantId}` },
    OccurredAt: new Date(occurredAt),
    CreatedAt: new Date(occurredAt),
    UpdatedAt: new Date(occurredAt),
    LastEventOccurredAt: new Date(occurredAt),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: `input of ${tenantId}`,
    ComputedOutput: `output of ${tenantId}`,
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TraceName: `trace of ${tenantId}`,
  };
}

/** One `stored_spans` row, named after the tenant that holds it. */
export function spanRow({
  tenantId,
  traceId,
  occurredAt,
}: {
  tenantId: string;
  traceId: string;
  occurredAt: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: `span-${nanoid(8)}`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(occurredAt),
    EndTime: new Date(occurredAt + 50),
    DurationMs: 50,
    SpanName: `span of ${tenantId}`,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: { "service.name": `service-of-${tenantId}` },
    SpanAttributes: {},
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [] as Date[],
    "Events.Name": [] as string[],
    "Events.Attributes": [] as Record<string, string>[],
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(occurredAt),
    UpdatedAt: new Date(occurredAt),
  };
}

/** A synchronous insert, so the rows are readable when it returns. */
export async function insertRows({
  ch,
  table,
  values,
}: {
  ch: ClickHouseClient;
  table: string;
  values: unknown[];
}): Promise<void> {
  await ch.insert({
    table,
    values,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}
