/** @vitest-environment node */

/**
 * Which of a caller's readable projects hold a trace id, as a summary or as spans only: the
 * read a by-id miss uses to name or serve the project the trace was sent to.
 * @see modules/trace/specs/trace-lookup-by-id.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { readyIdIndexedClientDouble } from "@langwatch/clickhouse-client/testing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { MemberTraceClickHouseClientRepository } from "../clickhouse.trace-member-client.repository.ts";
import { ClickHouseTraceExistenceRepository } from "../trace-existence.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const run = nanoid(8);
const summarised = `holding-summarised-${run}`;
const spansOnly = `holding-spans-only-${run}`;
const empty = `holding-empty-${run}`;
const traceId = `trace-${nanoid()}`;
const at = new Date().toISOString().replace("T", " ").replace("Z", "");

let ch: ClickHouseClient;
let repo: ClickHouseTraceExistenceRepository;

async function insert(table: string, row: Record<string, unknown>) {
  await ch.insert({
    table,
    values: [row],
    format: "JSONEachRow",
    clickhouse_settings: {
      async_insert: 0,
      wait_for_async_insert: 0,
      date_time_input_format: "best_effort",
    },
  });
}

function span(tenantId: string) {
  return {
    ProjectionId: `span-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: nanoid(16),
    Sampled: 1,
    StartTime: at,
    EndTime: at,
    DurationMs: 10,
    SpanName: "holding",
    SpanKind: 1,
    ServiceName: "holding",
  };
}

describe.skipIf(!testClickHouseConfigured())(
  "ClickHouseTraceExistenceRepository.findProjectsHoldingTrace (real ClickHouse)",
  () => {
    beforeAll(async () => {
      ch = await startMigratedTraceClickHouse();
      // The routed member, so the reads' id-index markers expand as they do in production.
      const member = await readyIdIndexedClientDouble({
        indexes: TRACE_ID_INDEXES,
        driver: {
          async execute(request: QueryRequest) {
            const result = await ch.query({
              query: request.sql,
              format: "JSONEachRow",
              ...(request.params === undefined ? {} : { query_params: request.params }),
            });
            return { rows: await result.json() };
          },
        },
      });
      repo = ClickHouseTraceExistenceRepository.create({
        resolveClient: MemberTraceClickHouseClientRepository.resolverFor(member),
      });
      await insert("trace_summaries", {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: summarised,
        TraceId: traceId,
        Version: "v1",
        OccurredAt: at,
        CreatedAt: at,
        UpdatedAt: at,
        TotalDurationMs: 10,
        SpanCount: 1,
        ContainsErrorStatus: false,
        ContainsOKStatus: true,
        Models: [],
        TokensEstimated: false,
      });
      await insert("stored_spans", span(summarised));
      await insert("stored_spans", span(spansOnly));
    }, 120_000);

    afterAll(async () => {
      if (!ch) return;
      for (const table of ["trace_summaries", "stored_spans"]) {
        await ch.exec({
          query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({a:String}, {b:String})`,
          query_params: { a: summarised, b: spansOnly },
        });
      }
    });

    describe("given one project with the trace summarised and one with its spans only", () => {
      it("answers both, and not the project that holds nothing", async () => {
        const holding = await repo.findProjectsHoldingTrace({
          projectIds: [summarised, spansOnly, empty],
          traceId,
        });

        expect(holding.toSorted()).toEqual([summarised, spansOnly].toSorted());
      });
    });
  },
);
