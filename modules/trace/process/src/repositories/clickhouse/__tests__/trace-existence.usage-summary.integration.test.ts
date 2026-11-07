/**
 * Nurturing's daily usage figures, read from trace_summaries: each trace once at its newest
 * version, over every named project, inside the window.
 * @see enterprise/modules/nurturing/specs/organization-usage.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceExistenceRepository } from "../trace-existence.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const run = nanoid(8);
const projectA = `usage-summary-a-${run}`;
const projectB = `usage-summary-b-${run}`;
const now = Date.now();
const since = now - 30 * DAY_MS;
const failedAt = now - 2 * DAY_MS;

const clickHouseConfigured = testClickHouseConfigured();

let ch: ClickHouseClient;
let repo: ClickHouseTraceExistenceRepository;

function row({
  tenantId,
  traceId,
  occurredAtMs,
  updatedAtMs = occurredAtMs,
  totalCost,
  failed = false,
}: {
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
  updatedAtMs?: number;
  totalCost: number | null;
  failed?: boolean;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(occurredAtMs),
    CreatedAt: new Date(occurredAtMs),
    UpdatedAt: new Date(updatedAtMs),
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: failed,
    ContainsOKStatus: !failed,
    Models: [],
    TotalCost: totalCost,
    TokensEstimated: false,
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = ClickHouseTraceExistenceRepository.create({ resolveClient: async () => ch });
  const rewritten = `trace-${nanoid()}`;
  await ch.insert({
    table: "trace_summaries",
    values: [
      // One trace in two versions: the newer one failed and cost more.
      row({ tenantId: projectA, traceId: rewritten, occurredAtMs: failedAt, totalCost: 0.1 }),
      row({
        tenantId: projectA,
        traceId: rewritten,
        occurredAtMs: failedAt,
        updatedAtMs: failedAt + 1_000,
        totalCost: 0.3,
        failed: true,
      }),
      row({
        tenantId: projectA,
        traceId: `trace-${nanoid()}`,
        occurredAtMs: now - DAY_MS,
        totalCost: 0.2,
      }),
      row({
        tenantId: projectB,
        traceId: `trace-${nanoid()}`,
        occurredAtMs: now - DAY_MS,
        totalCost: 0.5,
      }),
      // Older than the window: neither counted nor its failure kept.
      row({
        tenantId: projectA,
        traceId: `trace-${nanoid()}`,
        occurredAtMs: now - 40 * DAY_MS,
        totalCost: 9,
        failed: true,
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  await ch.exec({
    query: "ALTER TABLE trace_summaries DELETE WHERE TenantId IN ({a:String}, {b:String})",
    query_params: { a: projectA, b: projectB },
  });
  await ch.close();
});

describe.skipIf(!clickHouseConfigured)(
  "ClickHouseTraceExistenceRepository.summarizeUsage (integration)",
  () => {
    describe("given a trace stored in two versions, traces in two projects and one older than 30 days", () => {
      /** @scenario A trace stored in two versions counts once with its newest cost */
      it("counts each trace once at its newest version, summed over both projects, inside the window", async () => {
        const summary = await repo.summarizeUsage({ projectIds: [projectA, projectB], since });

        expect(summary).toMatchObject({ traces: 3, errors: 1, lastFailedTraceAt: failedAt });
        expect(summary.totalCost).toBeCloseTo(1.0, 9);
      });
    });

    describe("given no traces in the projects", () => {
      it("answers zeros and no failed time", async () => {
        const summary = await repo.summarizeUsage({ projectIds: [`empty-${run}`], since });

        expect(summary).toEqual({ traces: 0, errors: 0, totalCost: 0, lastFailedTraceAt: null });
      });
    });
  },
);
