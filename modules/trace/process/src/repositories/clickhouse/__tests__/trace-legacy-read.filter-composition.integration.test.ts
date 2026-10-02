/**
 * @vitest-environment node
 * @integration
 * The v1 search door's query-language `filter` on a migrated ClickHouse: it
 * narrows the read and is ANDed with the legacy filter map, free text and ids.
 * @see specs/traces/trace-filter-api.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TRACE_FILTER_EXAMPLES, type GetAllTracesForProjectInput } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { translateFilter } from "../../../rules/trace-query.rules.ts";
import { TraceCanonicalisationService } from "../../../services/trace-canonicalisation.service.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";
import { openProtections } from "./open-protections.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `test-filter-composition-${nanoid()}`;
const now = Date.now();
const window = { startDate: now - 60_000, endDate: now + 60_000 };

const FAILED_REFUND_U1 = `${tenantId}-failed-refund-u1`;
const FAILED_REFUND_U2 = `${tenantId}-failed-refund-u2`;
const OK_REFUND_U1 = `${tenantId}-ok-refund-u1`;
const FAILED_HELLO_U1 = `${tenantId}-failed-hello-u1`;

let ch: ClickHouseClient;
let repo: TraceLegacyReadClickHouseRepository;

function summaryRow({
  traceId,
  failed,
  userId,
  input,
}: {
  traceId: string;
  failed: boolean;
  userId: string;
  input: string;
}) {
  const at = new Date(now);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: { "langwatch.user_id": userId },
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: at,
    LastEventOccurredAt: at,
    ComputedIOSchemaVersion: "v1",
    ComputedInput: input,
    ComputedOutput: "done",
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: failed,
    ContainsOKStatus: !failed,
    Models: [],
    TraceName: "checkout",
  };
}

function searchInput(
  overrides: Partial<GetAllTracesForProjectInput> = {},
): GetAllTracesForProjectInput {
  return { projectId: tenantId, ...window, filters: {}, pageSize: 100, ...overrides };
}

async function search({
  queryText,
  input,
}: {
  queryText?: string;
  input?: Partial<GetAllTracesForProjectInput>;
}): Promise<string[]> {
  const filterWhere = queryText
    ? translateFilter({
        queryText,
        tenantId,
        timeRange: { from: window.startDate, to: window.endDate },
      })
    : null;
  const results = await repo.listAllTracesForProject(searchInput(input), openProtections, {
    downloadMode: true,
    ...(filterWhere ? { filterWhere } : {}),
  });
  return results.groups
    .flat()
    .map((trace) => trace.trace_id)
    .toSorted();
}

describe.skipIf(!clickHouseConfigured)("a trace search filter (integration)", () => {
  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
    repo = TraceLegacyReadClickHouseRepository.create({
      resolveClickHouseClient: async () => ch,
      traceCanonicalisation: TraceCanonicalisationService.create(),
      annotations: createApiFixture<AnnotationApi>({
        listForProjection: async () => [],
        listScoreNames: async () => [],
      }),
    });
    await ch.insert({
      table: "trace_summaries",
      values: [
        summaryRow({
          traceId: FAILED_REFUND_U1,
          failed: true,
          userId: "u_1",
          input: "refund please",
        }),
        summaryRow({
          traceId: FAILED_REFUND_U2,
          failed: true,
          userId: "u_2",
          input: "refund please",
        }),
        summaryRow({ traceId: OK_REFUND_U1, failed: false, userId: "u_1", input: "refund please" }),
        summaryRow({ traceId: FAILED_HELLO_U1, failed: true, userId: "u_1", input: "hello" }),
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  });

  describe("given two failed users, one succeeded trace and one failed unrelated trace", () => {
    /** @scenario A filter string narrows the search */
    it("returns only the traces that contain an error", async () => {
      expect(await search({ queryText: "status:error" })).toEqual(
        [FAILED_REFUND_U1, FAILED_REFUND_U2, FAILED_HELLO_U1].toSorted(),
      );
    });

    /** @scenario A filter combines with the legacy filter map rather than replacing it */
    it("keeps the legacy user filter beside the filter string", async () => {
      const traceIds = await search({
        queryText: "status:error",
        input: { filters: { "metadata.user_id": ["u_1"] } },
      });

      expect(traceIds).toEqual([FAILED_REFUND_U1, FAILED_HELLO_U1].toSorted());
    });

    /** @scenario A filter combines with free text and with an explicit trace id list */
    it("returns only the trace that satisfies the filter, the text and the id list", async () => {
      const traceIds = await search({
        queryText: "status:error",
        input: {
          query: "refund",
          traceIds: [FAILED_REFUND_U1, OK_REFUND_U1, FAILED_HELLO_U1],
        },
      });

      expect(traceIds).toEqual([FAILED_REFUND_U1]);
    });
  });

  describe("given the filter examples the reference publishes", () => {
    /** @scenario Every published filter example runs against the real schema */
    it.each(TRACE_FILTER_EXAMPLES.map((example) => [example.id, example.text] as const))(
      "[%s] is accepted by the database",
      async (_id, text) => {
        await expect(search({ queryText: text })).resolves.toBeInstanceOf(Array);
      },
    );
  });
});
