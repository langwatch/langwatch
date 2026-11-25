/**
 * Braids read only into traces the reader already has (ADR-201 §5, invariant "Only into the
 * reader's own traces"), against production schema: an owner-only trace is neither listed,
 * searched nor opened from the reader. Spec: modules/trace/specs/braided-spans.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Authorization, CompiledWhere } from "@langwatch/authorization";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { braidedProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceSummaryService } from "../../../features/read/services/trace-summary-read.service.ts";
import { traceQueryTranslation } from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { ClickHouseTraceSpanRepository } from "../trace-span.repository.ts";
import { TraceSummaryClickHouseRepository } from "../trace-summary.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const run = nanoid();
const reader = `test-braid-held-reader-${run}`;
const owner = `test-braid-held-owner-${run}`;
const HELD = `held-${run}`;
const OWNER_ONLY = `owner-only-${run}`;
const SHARED_ID = `shared-id-${run}`;
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};
const base = Date.now() - 60 * 60 * 1000;
const WINDOW = { from: base - 24 * 60 * 60 * 1000, to: Date.now() + 60 * 60 * 1000 };

let ch: ClickHouseClient;
let list: TraceListClickHouseRepository;
let spans: ClickHouseTraceSpanRepository;
let summaries: TraceSummaryService;

function summaryRow({ tenantId, traceId }: { tenantId: string; traceId: string }) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(base),
    CreatedAt: new Date(base),
    UpdatedAt: new Date(base),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: `input-${traceId}`,
    ComputedOutput: `output-${traceId}`,
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TokensEstimated: false,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: `name-of-${tenantId}`,
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(base),
  };
}

function spanRow({
  tenantId,
  traceId,
  spanId,
  parentSpanId = null,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: parentSpanId,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(base),
    EndTime: new Date(base + 50),
    DurationMs: 50,
    SpanName: spanId,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: { orchestrator: "web" },
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    CreatedAt: new Date(base),
    UpdatedAt: new Date(base),
  };
}

const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  const clickhouse = authorizedClickHouseFor(ch);
  list = TraceListClickHouseRepository.create({ clickhouse });
  spans = ClickHouseTraceSpanRepository.create({ clickhouse });
  summaries = TraceSummaryService.create({
    repository: TraceSummaryClickHouseRepository.create({
      resolveClient: async () => ch,
      clickhouse,
    }),
  });
  await ch.insert({
    table: "trace_summaries",
    values: [
      summaryRow({ tenantId: reader, traceId: HELD }),
      summaryRow({ tenantId: owner, traceId: HELD }),
      summaryRow({ tenantId: owner, traceId: OWNER_ONLY }),
      summaryRow({ tenantId: reader, traceId: SHARED_ID }),
      summaryRow({ tenantId: owner, traceId: SHARED_ID }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await ch.insert({
    table: "stored_spans",
    values: [
      spanRow({ tenantId: reader, traceId: HELD, spanId: "reader-root" }),
      spanRow({
        tenantId: owner,
        traceId: HELD,
        spanId: "owner-in-held",
        parentSpanId: "reader-root",
      }),
      spanRow({ tenantId: reader, traceId: SHARED_ID, spanId: "reader-shared" }),
      spanRow({ tenantId: owner, traceId: SHARED_ID, spanId: "owner-shared" }),
      spanRow({ tenantId: owner, traceId: OWNER_ONLY, spanId: "owner-alone" }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const table of ["trace_summaries", "stored_spans"]) {
    await ch.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({reader:String}, {owner:String})`,
      query_params: { reader, owner },
    });
  }
});

const proof = () => braidedProof({ projectId: reader, braids: [{ owner, compiledWhere: WEB }] });

async function listed({
  authorization,
  queryText,
}: {
  authorization: Authorization;
  queryText?: string;
}) {
  const filterWhere =
    queryText === undefined
      ? undefined
      : (traceQueryTranslation.translateFilter({ queryText, timeRange: WINDOW }) ?? undefined);
  const page = await list.listAll({
    authorization,
    timeRange: WINDOW,
    sort: { column: "OccurredAt", direction: "desc" },
    limit: 100,
    offset: 0,
    filterWhere,
  });
  const count = await list.findCount({
    authorization,
    timeRange: WINDOW,
    since: WINDOW.from,
    filterWhere,
  });
  return { traceIds: page.rows.map((row) => row.traceId), count };
}

/** Opens a trace as the drawer does: the header's summary, then the span tree under its proof. */
async function opened(traceId: string) {
  const authorization = await summaries.getTraceAuthorization({ authorization: proof(), traceId });
  const tree = await spans.listSummaryPage({ authorization, traceId, limit: 100 });
  const header = await summaries
    .getByTraceId({ authorization: proof(), traceId })
    .then(() => ({ code: "found" }))
    .catch((error: { code?: string }) => ({ code: error.code }));
  return { header, spanIds: tree.rows.map((row) => row.spanId) };
}

describe.skipIf(!clickHouseConfigured)("a trace only a braid's owner holds", () => {
  describe("when the reader lists or searches its traces", () => {
    /** @scenario "A trace only the owner holds is not listed for the reader" */
    it("is not listed, not found by search, and is answered as not found when opened", async () => {
      const heldIds = [HELD, SHARED_ID].toSorted();
      const sorted = async (input: Parameters<typeof listed>[0]) => {
        const { traceIds, count } = await listed(input);
        return { traceIds: traceIds.toSorted(), count };
      };
      expect(await sorted({ authorization: proof() })).toEqual({ traceIds: heldIds, count: 2 });
      expect(
        await sorted({ authorization: proof(), queryText: "span.attribute.orchestrator:web" }),
      ).toEqual({ traceIds: heldIds, count: 2 });

      expect(await opened(OWNER_ONLY)).toEqual({
        header: { code: "trace_not_found" },
        spanIds: [],
      });
    });

    /** @scenario "A trace only the owner holds is not listed for the reader" */
    it("shows no owner span in a trace held by trace id alone, with no span linked", async () => {
      const { header, spanIds } = await opened(SHARED_ID);

      expect(header).toEqual({ code: "found" });
      expect(spanIds).toEqual(["reader-shared"]);
    });
  });

  describe("when the reader opens a trace it holds", () => {
    it("reads the owner's matching spans into it", async () => {
      const { header, spanIds } = await opened(HELD);

      expect(header).toEqual({ code: "found" });
      expect(spanIds.toSorted()).toEqual(["owner-in-held", "reader-root"]);
    });
  });
});
