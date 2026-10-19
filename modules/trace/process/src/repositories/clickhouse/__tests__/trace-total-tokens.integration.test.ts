/**
 * @vitest-environment node
 * @integration
 * A trace's total tokens count its cache reads and writes on every ClickHouse read: the list,
 * its token sort and filter, and conversation groups.
 * @see specs/trace-processing/trace-token-totals.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { mapToTraceListItem } from "../../../rules/trace-list-row.rules.ts";
import { traceQueryTranslation } from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { SessionGroupsClickHouseRepository } from "../session-groups.repository.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `total-tokens-${nanoid()}`;
const conversationId = `conv-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;
const timeRange = { from: base - 60_000, to: base + 60_000 };

/** 30 fresh input, 44 output, 15217 written to the cache and 15217 read back. */
const CACHED_TRACE_TOTAL = 30 + 44 + 15_217 + 15_217;

function traceRow({
  traceId,
  offset,
  promptTokens,
  completionTokens,
  attributes,
}: {
  traceId: string;
  offset: number;
  promptTokens: number;
  completionTokens: number;
  attributes: Record<string, string>;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: { "gen_ai.conversation.id": conversationId, ...attributes },
    OccurredAt: new Date(base + offset),
    CreatedAt: new Date(base + offset),
    UpdatedAt: new Date(base + offset),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: "input",
    ComputedOutput: "output",
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: promptTokens,
    TotalCompletionTokenCount: completionTokens,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: traceId,
    RootSpanType: "",
    ContainsAi: true,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(base + offset),
    TopicId: null,
    SubTopicId: null,
  };
}

describe.skipIf(!clickHouseConfigured)("a trace's total tokens on ClickHouse reads", () => {
  let ch: ClickHouseClient;
  let list: TraceListClickHouseRepository;
  let groups: SessionGroupsClickHouseRepository;

  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
    list = TraceListClickHouseRepository.create({ clickhouse: authorizedClickHouseFor(ch) });
    groups = SessionGroupsClickHouseRepository.create({ clickhouse: authorizedClickHouseFor(ch) });
    await ch.insert({
      table: "trace_summaries",
      values: [
        traceRow({
          traceId: "cached-trace",
          offset: 0,
          promptTokens: 30,
          completionTokens: 44,
          attributes: {
            "langwatch.reserved.cache_read_tokens": "15217",
            "langwatch.reserved.cache_creation_tokens": "15217",
          },
        }),
        traceRow({
          traceId: "uncached-trace",
          offset: 1,
          promptTokens: 1000,
          completionTokens: 1000,
          attributes: {},
        }),
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

  const listTraces = (overrides: Record<string, unknown> = {}) =>
    list.listAll({
      authorization: ownProof({ projectId: tenantId }),
      timeRange,
      sort: { column: "OccurredAt", direction: "desc" },
      limit: 50,
      offset: 0,
      ...overrides,
    });

  /** @scenario "The trace list and the trace header show the total with the cache" */
  it("lists the cached trace with its cache reads and writes in the total", async () => {
    const page = await listTraces();
    const row = page.rows.find((candidate) => candidate.traceId === "cached-trace");
    if (!row) throw new Error("the cached trace was not listed");

    const item = mapToTraceListItem({ ...row, tenantId });

    expect(item.totalTokens).toBe(CACHED_TRACE_TOTAL);
    expect(item.inputTokens).toBe(30);
  });

  /** @scenario "Filtering and sorting by tokens use the total with the cache" */
  it("sorts by the total with the cache", async () => {
    const page = await listTraces({ sort: { column: "TotalTokens", direction: "desc" } });

    expect(page.rows.map((row) => row.traceId)).toEqual(["cached-trace", "uncached-trace"]);
  });

  /** @scenario "Filtering and sorting by tokens use the total with the cache" */
  it("filters by the total with the cache", async () => {
    const filterWhere = traceQueryTranslation.translateFilter({
      queryText: "tokens:>10000",
      timeRange,
    });
    if (!filterWhere) throw new Error("the token filter compiled to nothing");

    const page = await listTraces({ filterWhere });

    expect(page.rows.map((row) => row.traceId)).toEqual(["cached-trace"]);
  });

  /** @scenario "A conversation's total tokens add up its traces' totals with the cache" */
  it("adds the cache reads and writes to the conversation's total", async () => {
    const page = await groups.listSessionGroups({
      authorization: ownProof({ projectId: tenantId }),
      timeRange,
      sort: { column: "tokens", direction: "desc" },
      limit: 50,
    });

    const group = page.rows.find((candidate) => candidate.conversationId === conversationId);
    expect(group?.totalTokens).toBe(CACHED_TRACE_TOTAL + 2000);
  });
});
