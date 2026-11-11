import type { ClickHouseClient } from "@clickhouse/client";
import {
  createTenantId,
  FoldProjectionExecutor,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import { ASSIGN_TOPIC_COMMAND_TYPE, type AssignTopicCommandData } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProofAuthorizer } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  createSpanReceivedEvent,
  createTestRuntime,
  msToUnixNano,
} from "../../../eventing/__tests__/trace-summary-test.fixtures.ts";
import { TraceSummaryFoldProjection } from "../../../eventing/trace-summary.projection.ts";
import { TraceSummaryStore } from "../../../eventing/trace-summary.store.ts";
import { EventingTraceTopicAdapter } from "../../../eventing/trace-topic-assignment.commands.ts";
import { authorizedClickHouseFor } from "../../../repositories/clickhouse/__tests__/support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { ClickHouseTraceClusteringSampleRepository } from "../../../repositories/clickhouse/clickhouse.trace-clustering-sample.repository.ts";
import { TraceSummaryProjectionClickHouseRepository } from "../../../repositories/clickhouse/trace-summary.repository.ts";
import { TraceCanonicalisationService } from "../../derivation/services/trace-canonicalisation.service.ts";
import { TraceTopicClusteringReadService } from "../services/trace-topic-clustering-read.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-topic-landing-${nanoid()}`;
const NOW = Date.now();

let ch: ClickHouseClient;
let store: TraceSummaryStore;
let fold: TraceSummaryFoldProjection;
let readService: TraceTopicClusteringReadService;
const executor = new FoldProjectionExecutor();

/** The store's single-row write is a fire-and-forget async insert; reads must see it. */
async function flushWrites(): Promise<void> {
  await ch.command({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
}

function contextFor(traceId: string): ProjectionStoreContext {
  return {
    aggregateId: traceId,
    tenantId: createTenantId(tenantId),
    key: traceId,
  } as ProjectionStoreContext;
}

async function ingestTrace({ traceId, occurredAtMs }: { traceId: string; occurredAtMs: number }) {
  const span = createSpanReceivedEvent({
    eventId: `evt-span-${traceId}`,
    tenantId,
    traceId,
    spanId: "bbbb000000000001",
    occurredAt: occurredAtMs,
    startTimeUnixNano: msToUnixNano(occurredAtMs),
    endTimeUnixNano: msToUnixNano(occurredAtMs + 500),
    attributes: {
      "langwatch.input": JSON.stringify({ type: "text", value: `question ${traceId}` }),
    },
  });
  await executor.executeBatch(fold as never, [span] as never, contextFor(traceId));
  await flushWrites();
}

async function assign({ traceId, occurredAt }: { traceId: string; occurredAt: number }) {
  const data: AssignTopicCommandData = {
    tenantId,
    traceId,
    topicId: "topic_a",
    topicName: "Billing",
    subtopicId: "subtopic_a1",
    subtopicName: "Refunds",
    isIncremental: true,
    occurredAt,
  };
  const [event] = await EventingTraceTopicAdapter.create().handle({
    type: ASSIGN_TOPIC_COMMAND_TYPE,
    tenantId,
    aggregateId: traceId,
    data,
  } as never);
  await executor.executeBatch(fold as never, [event] as never, contextFor(traceId));
  await flushWrites();
}

async function incrementalPage(window?: { occurredSinceMs?: number; occurredBeforeMs?: number }) {
  return readService.readPage({
    projectId: tenantId,
    isIncrementalProcessing: true,
    topicIds: ["topic_a"],
    subtopicIds: ["subtopic_a1"],
    ...window,
  });
}

beforeAll(async () => {
  if (!testClickHouseConfigured()) return;
  ch = await startMigratedTraceClickHouse();
  store = TraceSummaryStore.create({
    storage: TraceSummaryProjectionClickHouseRepository.create({
      resolveClient: async () => ch,
      clickhouse: authorizedClickHouseFor(ch),
    }),
    defaultRetentionDays: () => 0,
    authorize: ownProofAuthorizer,
  });
  fold = TraceSummaryFoldProjection.create({
    store,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime: createTestRuntime(),
  });
  readService = TraceTopicClusteringReadService.create({
    repository: ClickHouseTraceClusteringSampleRepository.create({ resolveClient: async () => ch }),
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  await ch.exec({
    query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
  });
  await ch.close();
});

describe.skipIf(!testClickHouseConfigured())(
  "topic assignments on trace_summaries (integration)",
  () => {
    /** @scenario "A topic assignment lands on a trace older than the summary read window" */
    it("an assignment stamped with the trace's own time lands, so the next incremental run skips the trace", async () => {
      const traceId = `trace-old-${nanoid()}`;
      const occurredAtMs = NOW - 40 * DAY_MS;
      await ingestTrace({ traceId, occurredAtMs });
      expect((await incrementalPage()).traces.map((t) => t.trace_id)).toContain(traceId);

      const page = await incrementalPage();
      await assign({ traceId, occurredAt: page.occurredAtMsByTraceId[traceId]! });

      expect((await incrementalPage()).traces.map((t) => t.trace_id)).not.toContain(traceId);
    });

    /** @scenario "A topic assignment lands on a trace older than the summary read window" */
    it("an assignment stamped now never reaches a trace older than the read window", async () => {
      const traceId = `trace-lost-${nanoid()}`;
      await ingestTrace({ traceId, occurredAtMs: NOW - 40 * DAY_MS });

      await assign({ traceId, occurredAt: Date.now() });

      expect((await incrementalPage()).traces.map((t) => t.trace_id)).toContain(traceId);
    });

    /** @scenario "A finished run moves the clustering watermark so the next run skips what it read" */
    it("reads only the traces inside the run's OccurredAt window", async () => {
      const before = `trace-before-${nanoid()}`;
      const inside = `trace-inside-${nanoid()}`;
      const settling = `trace-settling-${nanoid()}`;
      await ingestTrace({ traceId: before, occurredAtMs: NOW - 3 * DAY_MS });
      await ingestTrace({ traceId: inside, occurredAtMs: NOW - DAY_MS });
      await ingestTrace({ traceId: settling, occurredAtMs: NOW - 10 * 60 * 1000 });

      const page = await incrementalPage({
        occurredSinceMs: NOW - 2 * DAY_MS,
        occurredBeforeMs: NOW - 60 * 60 * 1000,
      });

      const ids = page.traces.map((t) => t.trace_id);
      expect(ids).toContain(inside);
      expect(ids).not.toContain(before);
      expect(ids).not.toContain(settling);
    });
  },
);
