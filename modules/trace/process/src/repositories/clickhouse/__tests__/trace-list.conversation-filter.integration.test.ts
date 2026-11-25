/**
 * @vitest-environment node
 * @integration
 * A conversation id stored under a legacy key, filtered and counted on a migrated ClickHouse.
 * @see modules/trace/specs/trace-conversation-id-resolution.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { FACET_REGISTRY } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import type { TraceFilterWhere } from "../../../rules/trace-filter-hidden-origins.rules.ts";
import { traceQueryTranslation } from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

const base = Date.now() - 60 * 60 * 1000;
const timeRange = { from: base - 60_000, to: base + 60_000 };
const tenantId = `test-legacy-conversation-${nanoid()}`;
const legacyTraceId = "legacy-conversation-trace";
const bareTraceId = "no-conversation-trace";
const legacyConversationId = "thread-legacy-1";

function traceRow({
  traceId,
  offset,
  attributes,
}: {
  traceId: string;
  offset: number;
  attributes: Record<string, string>;
}) {
  const at = new Date(base + offset);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: attributes,
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: at,
    LastEventOccurredAt: at,
    ComputedIOSchemaVersion: "v1",
    ComputedInput: "hi",
    ComputedOutput: "done",
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: ["gpt-5-mini"],
    TraceName: "checkout flow",
  };
}

function compiled(queryText: string): TraceFilterWhere {
  const filter = traceQueryTranslation.translateFilter({ queryText, timeRange });
  if (!filter) throw new Error(`"${queryText}" compiled to no filter`);
  return filter;
}

function listWith(queryText: string) {
  return repo.listAll({
    authorization: ownProof({ projectId: tenantId }),
    timeRange,
    sort: { column: "OccurredAt", direction: "desc" },
    limit: 50,
    offset: 0,
    filterWhere: compiled(queryText),
  });
}

function conversationFacetExpression(): string {
  const facet = FACET_REGISTRY.find((entry) => entry.key === "conversation");
  if (!facet || !("expression" in facet))
    throw new Error("the conversation facet has no expression");
  return facet.expression;
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceListClickHouseRepository.create({ clickhouse: authorizedClickHouseFor(ch) });
  // Rows written before ingest folded thread ids onto gen_ai.conversation.id keep the raw key.
  await ch.insert({
    table: "trace_summaries",
    values: [
      traceRow({
        traceId: legacyTraceId,
        offset: 0,
        attributes: { "langgraph.thread_id": legacyConversationId },
      }),
      traceRow({ traceId: bareTraceId, offset: 1, attributes: {} }),
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

describe.skipIf(!clickHouseConfigured)("a conversation id stored under a legacy key", () => {
  describe("given a trace whose conversation id rides langgraph.thread_id only", () => {
    describe("when the list is filtered by that conversation id", () => {
      /** @scenario "Filtering by a legacy-key conversation id returns the trace from ClickHouse" */
      it("lists the trace and shows its conversation id", async () => {
        const page = await listWith(`conversation:"${legacyConversationId}"`);

        expect(page.rows.map((row) => row.traceId)).toEqual([legacyTraceId]);
        expect(page.rows[0]?.attributes["gen_ai.conversation.id"]).toBe(legacyConversationId);
        expect(page.totalHits).toBe(1);
      });
    });

    describe("when the list asks which traces have a conversation", () => {
      /** @scenario "Filtering by a legacy-key conversation id returns the trace from ClickHouse" */
      it("counts it under has:conversation and leaves it out of none:conversation", async () => {
        const withConversation = await listWith("has:conversation");
        const withoutConversation = await listWith("none:conversation");

        expect(withConversation.rows.map((row) => row.traceId)).toEqual([legacyTraceId]);
        expect(withoutConversation.rows.map((row) => row.traceId)).toEqual([bareTraceId]);
      });
    });

    describe("when the conversation facet is counted", () => {
      /** @scenario "Filtering by a legacy-key conversation id returns the trace from ClickHouse" */
      it("lists the trace under its conversation id", async () => {
        const batch = await repo.findBatchedFacets({
          authorization: ownProof({ projectId: tenantId }),
          timeRange,
          table: "trace_summaries",
          timeColumn: "OccurredAt",
          categoricalSpecs: [{ key: "conversation", expression: conversationFacetExpression() }],
          rangeSpecs: [],
          topN: 10,
        });
        const counts = Object.fromEntries(
          (batch.categoricals.conversation?.values ?? []).map((entry) => [
            entry.value,
            entry.count,
          ]),
        );

        expect(counts).toEqual({ [legacyConversationId]: 1 });
      });
    });
  });
});
