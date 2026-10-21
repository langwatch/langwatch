/**
 * The span tree under a braid, against production schema (ADR-183 §3, §5): the owner's matching
 * spans join the reader's trace, matched on each span's latest version and inside the braid's
 * window. Spec: modules/trace/specs/braided-spans.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { CompiledWhere } from "@langwatch/authorization";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { braidedProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { ClickHouseTraceSpanRepository } from "../trace-span.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const reader = `test-braid-reader-${nanoid()}`;
const owner = `test-braid-owner-${nanoid()}`;
const traceId = `trace-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

let ch: ClickHouseClient;
let repo: ClickHouseTraceSpanRepository;

function spanRow(input: {
  tenantId: string;
  spanId: string;
  offsetMs: number;
  updatedOffsetMs?: number;
  attributes?: Record<string, string>;
}) {
  const start = new Date(base + input.offsetMs);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: input.tenantId,
    TraceId: traceId,
    SpanId: input.spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: start,
    EndTime: new Date(base + input.offsetMs + 50),
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
    UpdatedAt: new Date(base + (input.updatedOffsetMs ?? input.offsetMs)),
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = ClickHouseTraceSpanRepository.create({ clickhouse: authorizedClickHouseFor(ch) });
  const web = { orchestrator: "web" };
  for (const row of [
    spanRow({ tenantId: reader, spanId: "reader-root", offsetMs: 0 }),
    spanRow({ tenantId: owner, spanId: "owner-web", offsetMs: 10, attributes: web }),
    spanRow({
      tenantId: owner,
      spanId: "owner-app",
      offsetMs: 20,
      attributes: { orchestrator: "app" },
    }),
    spanRow({ tenantId: owner, spanId: "owner-early", offsetMs: -120_000, attributes: web }),
    spanRow({ tenantId: owner, spanId: "owner-changed", offsetMs: 30, attributes: web }),
    spanRow({ tenantId: owner, spanId: "owner-changed", offsetMs: 30, updatedOffsetMs: 40 }),
  ]) {
    await ch.insert({
      table: "stored_spans",
      values: [row],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const tenantId of [reader, owner]) {
    await ch.exec({
      query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
});

async function readTree(from = 0) {
  const page = await repo.listSummaryPage({
    authorization: braidedProof({
      projectId: reader,
      braids: [{ owner, compiledWhere: WEB, from }],
    }),
    traceId,
    limit: 100,
    occurredAtMs: base - 180_000,
  });
  return page.rows.map((row) => [row.spanId, row.ownerProjectId ?? null]);
}

describe.skipIf(!clickHouseConfigured)("ClickHouseTraceSpanRepository under a braid", () => {
  describe("when the reader opens a trace the owner also recorded spans under", () => {
    /** @scenario "A reader's trace shows the owner's matching spans" */
    it("returns the owner's matching spans beside the reader's own, each naming its owner", async () => {
      expect(await readTree()).toEqual(
        expect.arrayContaining([
          ["reader-root", null],
          ["owner-web", owner],
        ]),
      );
    });

    /** @scenario "Owner spans that do not match never reach the reader" */
    it("never returns an owner span that does not match", async () => {
      expect((await readTree()).map(([spanId]) => spanId)).not.toContain("owner-app");
    });

    /** @scenario "The condition is applied to each span's latest version" */
    it("drops a span whose latest version stopped matching", async () => {
      expect((await readTree()).map(([spanId]) => spanId)).not.toContain("owner-changed");
    });

    /** @scenario "Spans outside the braid's data window do not appear" */
    it("returns only owner spans that started inside the braid's window", async () => {
      const spanIds = (await readTree(base - 60_000)).map(([spanId]) => spanId);

      expect(spanIds).toContain("owner-web");
      expect(spanIds).not.toContain("owner-early");
    });
  });
});
