/**
 * A braid with no condition (ADR-183 §3), against production schema: opening a trace the reader
 * holds reads every owner span under that trace id, whatever its name or attributes, and opening
 * a trace only the owner holds reads none. Spec: modules/authz/specs/braids.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { CompiledWhere } from "@langwatch/authorization";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { braidedProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceSummaryService } from "../../../features/read/services/trace-summary-read.service.ts";
import { ClickHouseTraceSpanRepository } from "../trace-span.repository.ts";
import { TraceSummaryClickHouseRepository } from "../trace-summary.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const run = nanoid();
const reader = `test-braid-unconditioned-reader-${run}`;
const owner = `test-braid-unconditioned-owner-${run}`;
const HELD = `held-${run}`;
const ALSO_HELD = `also-held-${run}`;
const OWNER_ONLY = `owner-only-${run}`;
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};
const base = Date.now() - 60 * 60 * 1000;

let ch: ClickHouseClient;
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
  name = spanId,
  attributes = {},
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  name?: string;
  attributes?: Record<string, string>;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(base),
    EndTime: new Date(base + 50),
    DurationMs: 50,
    SpanName: name,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: attributes,
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
      summaryRow({ tenantId: reader, traceId: ALSO_HELD }),
      summaryRow({ tenantId: owner, traceId: HELD }),
      summaryRow({ tenantId: owner, traceId: ALSO_HELD }),
      summaryRow({ tenantId: owner, traceId: OWNER_ONLY }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await ch.insert({
    table: "stored_spans",
    values: [
      spanRow({ tenantId: reader, traceId: HELD, spanId: "reader-root" }),
      spanRow({ tenantId: reader, traceId: ALSO_HELD, spanId: "reader-also-root" }),
      spanRow({
        tenantId: owner,
        traceId: HELD,
        spanId: "owner-web",
        attributes: { orchestrator: "web" },
      }),
      spanRow({
        tenantId: owner,
        traceId: HELD,
        spanId: "owner-app",
        attributes: { orchestrator: "app" },
      }),
      spanRow({ tenantId: owner, traceId: HELD, spanId: "owner-bare" }),
      spanRow({ tenantId: owner, traceId: HELD, spanId: "owner-pay", name: "payments_agent" }),
      spanRow({ tenantId: owner, traceId: ALSO_HELD, spanId: "owner-also" }),
      spanRow({
        tenantId: owner,
        traceId: OWNER_ONLY,
        spanId: "owner-alone",
        attributes: { orchestrator: "web" },
      }),
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

type Braid = Parameters<typeof braidedProof>[0]["braids"][number];

/** Opens a trace as the drawer does: the header's summary, then the span tree under its proof. */
async function opened({ traceId, braid }: { traceId: string; braid: Braid }) {
  const proof = braidedProof({ projectId: reader, braids: [braid] });
  const authorization = await summaries.getTraceAuthorization({ authorization: proof, traceId });
  const tree = await spans.listSummaryPage({ authorization, traceId, limit: 100 });
  const header = await summaries
    .getByTraceId({ authorization: proof, traceId })
    .then(() => "found")
    .catch((error: { code?: string }) => error.code);
  return {
    header,
    spans: tree.rows.map((row) => `${row.spanId}@${row.ownerProjectId ?? reader}`).toSorted(),
  };
}

describe.skipIf(!clickHouseConfigured)("a braid with no condition", () => {
  describe("when the reader opens a trace it holds", () => {
    /** @scenario "A braid with no condition braids every owner span in the reader's traces" */
    it("reads every owner span under the trace id into each held trace, each naming its owner", async () => {
      expect(await opened({ traceId: HELD, braid: { owner } })).toEqual({
        header: "found",
        spans: [
          `owner-app@${owner}`,
          `owner-bare@${owner}`,
          `owner-pay@${owner}`,
          `owner-web@${owner}`,
          `reader-root@${reader}`,
        ],
      });
      expect(await opened({ traceId: ALSO_HELD, braid: { owner } })).toEqual({
        header: "found",
        spans: [`owner-also@${owner}`, `reader-also-root@${reader}`],
      });
    });

    it("reads only the matching owner spans once the braid has a condition", async () => {
      expect((await opened({ traceId: HELD, braid: { owner, compiledWhere: WEB } })).spans).toEqual(
        [`owner-web@${owner}`, `reader-root@${reader}`],
      );
    });
  });

  describe("when the reader opens a trace only the owner holds", () => {
    /** @scenario "A braid with no condition braids every owner span in the reader's traces" */
    it("reads none of the owner's spans and answers not found", async () => {
      expect(await opened({ traceId: OWNER_ONLY, braid: { owner } })).toEqual({
        header: "trace_not_found",
        spans: [],
      });
    });
  });
});
