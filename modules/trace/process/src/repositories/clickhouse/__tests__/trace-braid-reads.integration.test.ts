/**
 * The braid dialog's and Braids page's reads against production schema (ADR-185 §7): each
 * statement reads one project under its own proof. Spec: modules/trace/specs/braided-spans.feature,
 * modules/authz/specs/braids-screen.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { CompiledWhere } from "@langwatch/authorization";
import type { AuthzBraid } from "@langwatch/authz-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { braidedProof, ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceBraidPreviewService } from "../../../services/trace-braid-preview.service.ts";
import { ClickHouseTraceBraidReadsRepository } from "../trace-braid-reads.repository.ts";
import { ClickHouseTraceSpanRepository } from "../trace-span.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const reader = `test-braid-preview-reader-${nanoid()}`;
const owner = `test-braid-preview-owner-${nanoid()}`;
const now = Date.now();
const base = now - 60 * 60 * 1000;
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
const WEB_TEXT = 'attributes["orchestrator"] == "web"';
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};
const trace = {
  every: `trace-every-${nanoid()}`,
  some: `trace-some-${nanoid()}`,
  none: `trace-none-${nanoid()}`,
  empty: `trace-empty-${nanoid()}`,
  old: `trace-old-${nanoid()}`,
  ownerOnly: `trace-owner-only-${nanoid()}`,
};
const web = { orchestrator: "web" };
const app = { orchestrator: "app" };
const signed = { ...web, "langwatch.reserved.verified.sig": reader };
const billing = { team: "billing" };
const MINUTE_MS = 60 * 1000;
/** A second pair: the reader already sees `web` spans through a braid that ended 20 minutes ago. */
const pair = {
  reader: `test-braid-pair-reader-${nanoid()}`,
  owner: `test-braid-pair-owner-${nanoid()}`,
  older: `trace-pair-older-${nanoid()}`,
  newer: `trace-pair-newer-${nanoid()}`,
  nothing: `trace-pair-nothing-${nanoid()}`,
  liveUntil: base - 20 * MINUTE_MS,
};

let ch: ClickHouseClient;
let service: TraceBraidPreviewService;

function spanRow(input: {
  tenantId: string;
  traceId: string;
  spanId: string;
  at?: number;
  attributes?: Record<string, string>;
}) {
  const start = new Date(input.at ?? base);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: input.tenantId,
    TraceId: input.traceId,
    SpanId: input.spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: start,
    EndTime: new Date(start.getTime() + 50),
    DurationMs: 50,
    SpanName: input.spanId,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: input.attributes ?? {},
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
    CreatedAt: start,
    UpdatedAt: start,
  };
}

function summaryRow({
  traceId,
  at = base,
  tenantId = reader,
}: {
  traceId: string;
  at?: number;
  tenantId?: string;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(at),
    CreatedAt: new Date(at),
    UpdatedAt: new Date(at),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: null,
    ComputedOutput: null,
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
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    SatisfactionScore: null,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

/** The pair's spans: `web` inside and after the live braid's window, `billing` in the draft's. */
function pairSpanRows() {
  const at = (minutes: number) => base - minutes * MINUTE_MS;
  const owned = (traceId: string, spanId: string, minutes: number, attributes: object) =>
    spanRow({
      tenantId: pair.owner,
      traceId,
      spanId,
      at: at(minutes),
      attributes: { ...attributes },
    });
  return [
    ...[pair.older, pair.newer, pair.nothing].map((traceId) =>
      spanRow({ tenantId: pair.reader, traceId, spanId: `root-${traceId}`, at: at(5) }),
    ),
    owned(pair.older, "p-old-web", 30, web),
    owned(pair.older, "p-old-billing", 30, billing),
    owned(pair.older, "p-old-web-late", 10, web),
    owned(pair.newer, "p-new-billing", 5, billing),
    owned(pair.newer, "p-new-app", 5, app),
    owned(pair.nothing, "p-nothing-app", 5, app),
  ];
}

const braid: AuthzBraid = {
  braidId: "braid_web",
  ownerProjectId: owner,
  readerProjectId: reader,
  where: WEB_TEXT,
  fromMs: 0,
  expiresAtMs: null,
  createdByUserId: null,
  createdAtMs: 0,
};

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  const clickhouse = authorizedClickHouseFor(ch);
  const spans = ClickHouseTraceSpanRepository.create({ clickhouse });
  service = TraceBraidPreviewService.create({
    reads: ClickHouseTraceBraidReadsRepository.create({ clickhouse }),
    readerSpans: async ({ authorization, traceId }) =>
      (await spans.listSummaryPage({ authorization, traceId, limit: 100, occurredAtMs: base }))
        .rows,
    braids: {
      listBraids: async ({ projectId }) => ({
        intoOtherProjects: projectId === owner ? [braid] : [],
        fromOtherProjects: projectId === reader ? [braid] : [],
      }),
    },
  });
  const old = now - EIGHT_DAYS_MS;
  const spanRows = [
    ...[trace.every, trace.some, trace.none, trace.empty].map((traceId) =>
      spanRow({ tenantId: reader, traceId, spanId: `root-${traceId}` }),
    ),
    spanRow({ tenantId: owner, traceId: trace.every, spanId: "o-web-1", attributes: signed }),
    spanRow({ tenantId: owner, traceId: trace.every, spanId: "o-web-2", attributes: web }),
    spanRow({ tenantId: owner, traceId: trace.some, spanId: "o-web-3", attributes: web }),
    spanRow({ tenantId: owner, traceId: trace.some, spanId: "o-app-1", attributes: app }),
    spanRow({ tenantId: owner, traceId: trace.none, spanId: "o-app-2", attributes: app }),
    spanRow({ tenantId: owner, traceId: trace.old, spanId: "o-old", at: old, attributes: web }),
    spanRow({ tenantId: owner, traceId: trace.ownerOnly, spanId: "o-alone", attributes: web }),
    ...pairSpanRows(),
  ];
  const summaryRows = [
    ...[trace.every, trace.some, trace.none, trace.empty].map((traceId) => summaryRow({ traceId })),
    summaryRow({ traceId: trace.old, at: old }),
    ...[pair.older, pair.newer, pair.nothing].map((traceId) =>
      summaryRow({ traceId, tenantId: pair.reader, at: base - 5 * MINUTE_MS }),
    ),
  ];
  const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
  await ch.insert({
    table: "stored_spans",
    values: spanRows,
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await ch.insert({
    table: "trace_summaries",
    values: summaryRows,
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const table of ["stored_spans", "trace_summaries"]) {
    await ch.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({tenants:Array(String)})`,
      query_params: { tenants: [reader, owner, pair.reader, pair.owner] },
    });
  }
});

const proofs = () => ({
  ownerAuthorization: ownProof({ projectId: owner }),
  readerAuthorization: ownProof({ projectId: reader }),
});

describe.skipIf(!clickHouseConfigured)("braid reads against ClickHouse", () => {
  describe("when an admin previews a condition", () => {
    /** @scenario "The preview counts the reader's last 7 days of traces" */
    it("counts the reader's recent traces by every, some or no owner span matching", async () => {
      const preview = await service.preview({ ...proofs(), where: WEB_TEXT, fromMs: 0 });

      expect(preview).toMatchObject({
        refusal: null,
        traces: { every: 1, some: 1, none: 2, total: 4, capped: false },
        spans: 3,
        live: { braids: 0, spans: 0 },
        unsignedHidden: null,
      });
      expect([trace.every, trace.some]).toContain(preview.example?.traceId);
    });

    /** @scenario "The preview counts calls that would stay hidden for want of a valid signature" */
    it("counts the otherwise matching owner spans that carry no valid signature", async () => {
      const preview = await service.preview({
        ...proofs(),
        where: `${WEB_TEXT} and Verified("sig")`,
        fromMs: 0,
      });

      expect(preview.traces).toMatchObject({ every: 0, some: 1, none: 3, total: 4 });
      expect(preview.unsignedHidden).toBe(2);
    });
  });

  describe("when the reader already sees spans from the owner through a live braid", () => {
    const pairProofs = () => ({
      ownerAuthorization: ownProof({ projectId: pair.owner }),
      readerAuthorization: braidedProof({
        projectId: pair.reader,
        braids: [{ owner: pair.owner, compiledWhere: WEB, from: 0, until: pair.liveUntil }],
      }),
    });
    const draft = { where: 'attributes["team"] == "billing"', fromMs: base - 60 * MINUTE_MS };

    /** @scenario A further braid on the same pair says what it adds */
    it("counts the live braid and the draft together, each in its own window, and the spans it adds", async () => {
      const preview = await service.preview({ ...pairProofs(), ...draft });

      expect(preview).toMatchObject({
        traces: { every: 0, some: 2, none: 1, total: 3, capped: false },
        spans: 3,
        live: {
          braids: 1,
          traces: { every: 0, some: 1, none: 2, total: 3, capped: false },
          spans: 1,
        },
      });
    });

    /** @scenario The preview counts what the reader will see as the condition changes */
    it("shows the newest trace getting a braided span, each owner span marked", async () => {
      const preview = await service.preview({ ...pairProofs(), ...draft });

      expect(preview.example?.traceId).toBe(pair.newer);
      expect(
        preview.example?.nodes.map((node) => [
          node.spanId,
          node.ownerProjectId ?? null,
          node.braided,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [`root-${pair.newer}`, null, undefined],
          ["p-new-billing", pair.owner, true],
          ["p-new-app", pair.owner, false],
        ]),
      );
    });

    /** @scenario Testing a trace shows it exactly as the reader will see it */
    it("marks a span only the live braid shows as braided when a trace is tested", async () => {
      const tested = await service.testTrace({ ...pairProofs(), ...draft, traceId: pair.older });

      expect(
        tested.nodes.map((node) => [node.spanId, node.ownerProjectId ?? null, node.braided]),
      ).toEqual(
        expect.arrayContaining([
          [`root-${pair.older}`, null, undefined],
          ["p-old-web", pair.owner, true],
          ["p-old-billing", pair.owner, true],
          ["p-old-web-late", pair.owner, false],
        ]),
      );
    });

    it("tests a trace with the draft in place of the braid being edited", async () => {
      const tested = await service.testTrace({
        ...pairProofs(),
        ...draft,
        traceId: pair.older,
        braidId: "braid_0",
      });

      expect(tested.nodes.find((node) => node.spanId === "p-old-web")?.braided).toBe(false);
    });

    it("lets the draft replace the braid being edited rather than count beside it", async () => {
      const preview = await service.preview({
        ...pairProofs(),
        where: WEB_TEXT,
        fromMs: 0,
        braidId: "braid_0",
      });

      expect(preview).toMatchObject({
        traces: { every: 0, some: 1, none: 2, total: 3 },
        spans: 2,
        live: { braids: 0, spans: 0 },
      });
      expect(preview.example?.traceId).toBe(pair.older);
    });
  });

  describe("when an admin tests a condition against a trace id", () => {
    /** @scenario "Testing a trace renders it exactly as the reader will see it" */
    it("returns the reader's spans and the owner's, each owner span marked braided or not", async () => {
      const tested = await service.testTrace({
        ...proofs(),
        where: WEB_TEXT,
        fromMs: 0,
        traceId: trace.some,
      });

      expect(tested.found).toBe(true);
      expect(
        tested.nodes.map((node) => [node.spanId, node.ownerProjectId ?? null, node.braided]),
      ).toEqual(
        expect.arrayContaining([
          [`root-${trace.some}`, null, undefined],
          ["o-web-3", owner, true],
          ["o-app-1", owner, false],
        ]),
      );
    });

    /** @scenario "The preview never reads a trace the reader does not have" */
    it("neither counts nor returns a trace only the owner recorded in", async () => {
      const tested = await service.testTrace({
        ...proofs(),
        where: WEB_TEXT,
        fromMs: 0,
        traceId: trace.ownerOnly,
      });
      const preview = await service.preview({ ...proofs(), where: WEB_TEXT, fromMs: 0 });

      expect(tested).toEqual({ found: false, nodes: [] });
      expect(preview.traces.total).toBe(4);
    });
  });

  describe("when the condition editor asks for the owner's attribute keys", () => {
    /** @scenario "The condition editor offers the owner's attribute keys" */
    it("returns the owner's keys most frequent first, leaving LangWatch's reserved keys out", async () => {
      const { keys } = await service.attributeKeys({
        authorization: ownProof({ projectId: owner }),
      });

      expect(keys[0]).toEqual({ key: "orchestrator", spanCount: 6 });
      expect(keys.map(({ key }) => key).filter((key) => key.startsWith("langwatch."))).toEqual([]);
    });
  });

  describe("when each side's Braids page asks for a braid's activity", () => {
    /** @scenario "Each Braids page counts a braid's last 24 hours with its own project's proof" */
    it("counts the owner's matching spans on its page and the braided spans on the reader's", async () => {
      const onOwnerPage = await service.activity({
        projectId: owner,
        authorization: ownProof({ projectId: owner }),
        braidIds: [braid.braidId, "braid_elsewhere"],
      });
      const onReaderPage = await service.activity({
        projectId: reader,
        authorization: braidedProof({
          projectId: reader,
          braids: [{ owner, compiledWhere: WEB }],
        }),
        braidIds: [braid.braidId],
      });

      expect(onOwnerPage).toEqual({ activity: [{ braidId: braid.braidId, spanCount: 4 }] });
      expect(onReaderPage).toEqual({ activity: [{ braidId: braid.braidId, spanCount: 4 }] });
    });
  });
});
