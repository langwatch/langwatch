/** @vitest-environment node */

/**
 * The ops reads a staff investigation asks (ADR-202): per-project trace counts over a range and
 * one trace's presence, over the shipped schema, with another project's rows beside them.
 * Spec: modules/trace/specs/trace-ops-reads.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceExistenceRepository } from "../trace-existence.repository.ts";
import { traceResolverFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const HOUR_MS = 60 * 60 * 1000;
const run = nanoid(8);
const project = `ops-reads-${run}`;
const otherProject = `ops-reads-other-${run}`;
const emptyProject = `ops-reads-empty-${run}`;
const now = Date.now();
const rangeStart = now - 10 * HOUR_MS;
const rangeEnd = now - 2 * HOUR_MS;
const presentTraceId = `trace-${nanoid()}`;

let ch: ClickHouseClient;
let repo: ClickHouseTraceExistenceRepository;

const insertSettings = {
  async_insert: 0,
  wait_for_async_insert: 0,
  date_time_input_format: "best_effort",
} as const;

async function storeSummary({
  tenantId,
  traceId,
  occurredAtMs,
}: {
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
}) {
  const at = new Date(occurredAtMs);
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        Version: "v1",
        OccurredAt: at,
        CreatedAt: at,
        UpdatedAt: at,
        TotalDurationMs: 100,
        SpanCount: 1,
        ContainsErrorStatus: false,
        ContainsOKStatus: true,
        Models: [],
        TokensEstimated: false,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: insertSettings,
  });
}

async function storeSpan({
  tenantId,
  traceId,
  spanId,
  writtenAtMs,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  writtenAtMs: number;
}) {
  const at = new Date(writtenAtMs);
  await ch.insert({
    table: "stored_spans",
    values: [
      {
        ProjectionId: `span-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        SpanId: spanId,
        Sampled: 1,
        StartTime: at,
        EndTime: at,
        DurationMs: 100,
        SpanName: "ops-reads",
        SpanKind: 1,
        ServiceName: "ops-reads",
        CreatedAt: at,
        UpdatedAt: at,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: insertSettings,
  });
}

describe.skipIf(!testClickHouseConfigured())("trace ops reads (real ClickHouse)", () => {
  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
    repo = ClickHouseTraceExistenceRepository.create({ resolveClient: traceResolverFor(ch) });
    const latestInRange = `trace-${nanoid()}`;
    await storeSummary({
      tenantId: project,
      traceId: `trace-${nanoid()}`,
      occurredAtMs: rangeStart + HOUR_MS,
    });
    await storeSummary({
      tenantId: project,
      traceId: latestInRange,
      occurredAtMs: rangeEnd - HOUR_MS,
    });
    // A second summary version of the same trace counts once.
    await storeSummary({
      tenantId: project,
      traceId: latestInRange,
      occurredAtMs: rangeEnd - HOUR_MS,
    });
    await storeSummary({
      tenantId: project,
      traceId: `trace-${nanoid()}`,
      occurredAtMs: rangeStart - HOUR_MS,
    });
    await storeSummary({ tenantId: project, traceId: `trace-${nanoid()}`, occurredAtMs: rangeEnd });
    await storeSummary({
      tenantId: otherProject,
      traceId: `trace-${nanoid()}`,
      occurredAtMs: rangeStart + HOUR_MS,
    });

    await storeSpan({
      tenantId: project,
      traceId: presentTraceId,
      spanId: "span-a",
      writtenAtMs: now - 3 * HOUR_MS,
    });
    await storeSpan({
      tenantId: project,
      traceId: presentTraceId,
      spanId: "span-b",
      writtenAtMs: now - HOUR_MS,
    });
    // A re-ingested span is one span.
    await storeSpan({
      tenantId: project,
      traceId: presentTraceId,
      spanId: "span-b",
      writtenAtMs: now - HOUR_MS,
    });
    await storeSpan({
      tenantId: otherProject,
      traceId: `trace-${nanoid()}`,
      spanId: "span-c",
      writtenAtMs: now,
    });
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    for (const table of ["trace_summaries", "stored_spans"]) {
      await ch.command({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({project:String}, {other:String})`,
        query_params: { project, other: otherProject },
      });
    }
  });

  describe("given traces inside and outside a range, and another project's traces", () => {
    describe("when ingestion is counted for both projects and one with no traces", () => {
      /** @scenario Ingestion is counted per asked project over a time range */
      it("gives each project its own count and latest time, and zeros to the empty one", async () => {
        const rows = await repo.countTracesByProject({
          projectIds: [project, otherProject, emptyProject],
          since: rangeStart,
          until: rangeEnd,
        });

        expect(rows).toEqual([
          { projectId: project, traces: 2, lastTraceAt: rangeEnd - HOUR_MS },
          { projectId: otherProject, traces: 1, lastTraceAt: rangeStart + HOUR_MS },
          { projectId: emptyProject, traces: 0, lastTraceAt: null },
        ]);
      });
    });
  });

  describe("given a trace with spans stored in a project", () => {
    describe("when its presence is asked in that project", () => {
      /** @scenario A stored trace's presence holds its span count and arrival times only */
      it("answers the span count and the first and last arrival, nothing else", async () => {
        const presence = await repo.findTracePresence({
          projectId: project,
          traceId: presentTraceId,
        });

        expect(presence).toEqual([
          {
            traceId: presentTraceId,
            projectId: project,
            firstSeenAt: now - 3 * HOUR_MS,
            lastSeenAt: now - HOUR_MS,
            spanCount: 2,
          },
        ]);
      });
    });

    describe("when its presence is asked in another project, or for an unknown id", () => {
      /** @scenario A stored trace's presence holds its span count and arrival times only */
      it("answers nothing", async () => {
        await expect(
          repo.findTracePresence({ projectId: otherProject, traceId: presentTraceId }),
        ).resolves.toEqual([]);
        await expect(
          repo.findTracePresence({ projectId: project, traceId: `trace-${nanoid()}` }),
        ).resolves.toEqual([]);
      });
    });
  });
});
