/**
 * A trace is held for an owner only through a parent-child link to a reader span, either way, or
 * to a span of an owner already held, each hop braided (ADR-201 §3), against production schema: a
 * shared trace id, a forged span or an unbraided hop shows nothing. Spec: braided-spans.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { BRAID_HELD_MAX_HOPS, type CompiledWhere } from "@langwatch/authorization";
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

const run = nanoid();
const reader = `test-braid-linked-reader-${run}`;
const owner = `test-braid-linked-owner-${run}`;
const SHARED_ONLY = `shared-only-${run}`;
const READER_PARENT = `reader-parent-${run}`;
const OWNER_PARENT = `owner-parent-${run}`;
const FORGED = `forged-${run}`;
const RETURNS = `returns-${run}`;
const EMPTY_ID = `empty-id-${run}`;
const ZERO_ID = `zero-id-${run}`;
const ZERO = "0000000000000000";
const search = `test-braid-linked-search-${run}`;
const billing = `test-braid-linked-billing-${run}`;
const chained = Array.from(
  { length: BRAID_HELD_MAX_HOPS + 1 },
  (_, index) => `test-braid-linked-hop${index + 1}-${run}`,
);
const CHAIN = `chain-${run}`;
const BROKEN = `broken-${run}`;
const DEEP = `deep-${run}`;
const LOOP = `loop-${run}`;
const base = Date.now() - 60 * 60 * 1000;
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

let ch: ClickHouseClient;
let repo: ClickHouseTraceSpanRepository;

function spanRow(input: {
  tenantId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  offsetMs: number;
  attributes?: Record<string, string>;
}) {
  const start = new Date(base + input.offsetMs);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: input.tenantId,
    TraceId: input.traceId,
    SpanId: input.spanId,
    ParentSpanId: input.parentSpanId ?? null,
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
    CreatedAt: start,
    UpdatedAt: start,
  };
}

const web = { orchestrator: "web" };
const app = { orchestrator: "app" };

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = ClickHouseTraceSpanRepository.create({ clickhouse: authorizedClickHouseFor(ch) });
  const row = (traceId: string, tenantId: string, spanId: string, offsetMs: number, rest = {}) =>
    spanRow({ tenantId, traceId, spanId, offsetMs, ...rest });
  await ch.insert({
    table: "stored_spans",
    values: [
      row(SHARED_ONLY, reader, "reader-root", 0),
      row(SHARED_ONLY, owner, "owner-web", 10, { attributes: web }),
      row(SHARED_ONLY, owner, "owner-child", 20, { parentSpanId: "owner-web", attributes: web }),
      row(SHARED_ONLY, owner, "owner-elsewhere", 30, {
        parentSpanId: "span-nobody-holds",
        attributes: web,
      }),

      row(READER_PARENT, reader, "reader-root", 0),
      row(READER_PARENT, owner, "owner-linked", 10, {
        parentSpanId: "reader-root",
        attributes: web,
      }),
      row(READER_PARENT, owner, "owner-deep", 20, {
        parentSpanId: "owner-linked",
        attributes: web,
      }),
      row(READER_PARENT, owner, "owner-deep-app", 30, {
        parentSpanId: "owner-deep",
        attributes: app,
      }),

      row(OWNER_PARENT, owner, "owner-root", 0, { attributes: web }),
      row(OWNER_PARENT, reader, "reader-child", 10, { parentSpanId: "owner-root" }),
      row(OWNER_PARENT, owner, "owner-deep", 20, { parentSpanId: "owner-root", attributes: web }),
      row(OWNER_PARENT, owner, "owner-deep-app", 30, {
        parentSpanId: "owner-deep",
        attributes: app,
      }),

      row(FORGED, owner, "owner-root", 0, { attributes: web }),
      row(FORGED, owner, "owner-child", 10, { parentSpanId: "owner-root", attributes: web }),
      row(FORGED, reader, `forged-${nanoid()}`, 20, { parentSpanId: `forged-parent-${nanoid()}` }),

      row(EMPTY_ID, owner, "owner-root", 0, { attributes: web }),
      row(EMPTY_ID, owner, "owner-child", 10, { parentSpanId: "owner-root", attributes: web }),
      row(EMPTY_ID, reader, "", 20),

      row(ZERO_ID, owner, "owner-root", 0, { parentSpanId: ZERO, attributes: web }),
      row(ZERO_ID, owner, "owner-orphan", 5, { attributes: web }),
      row(ZERO_ID, reader, ZERO, 20, { parentSpanId: ZERO }),

      row(RETURNS, reader, "reader-first", 0),
      row(RETURNS, owner, "owner-hop", 10, { parentSpanId: "reader-first", attributes: web }),
      row(RETURNS, reader, "reader-second", 20, { parentSpanId: "owner-hop" }),
      row(RETURNS, owner, "owner-after", 30, { parentSpanId: "reader-second", attributes: web }),
      row(RETURNS, owner, "owner-after-app", 40, { parentSpanId: "owner-after", attributes: app }),

      row(CHAIN, reader, "reader-root", 0),
      row(CHAIN, owner, "owner-hop", 10, { parentSpanId: "reader-root", attributes: web }),
      row(CHAIN, owner, "owner-app", 15, { parentSpanId: "owner-hop", attributes: app }),
      row(CHAIN, search, "search-hop", 20, { parentSpanId: "owner-app" }),

      row(BROKEN, reader, "reader-root", 0),
      row(BROKEN, owner, "owner-hop", 10, { parentSpanId: "reader-root", attributes: web }),
      row(BROKEN, billing, "billing-hop", 20, { parentSpanId: "owner-hop" }),
      row(BROKEN, search, "search-hop", 30, { parentSpanId: "billing-hop" }),

      row(DEEP, reader, "reader-root", 0),
      ...chained.map((hop, index) =>
        row(DEEP, hop, `hop-${index + 1}`, 10 * (index + 1), {
          parentSpanId: index === 0 ? "reader-root" : `hop-${index}`,
        }),
      ),

      row(LOOP, search, "search-root", 0),
      row(LOOP, owner, "owner-hop", 10, { parentSpanId: "search-root", attributes: web }),
      row(LOOP, reader, "reader-back", 20, { parentSpanId: "owner-hop" }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  await ch.exec({
    query: "ALTER TABLE stored_spans DELETE WHERE TenantId IN {tenants:Array(String)}",
    query_params: { tenants: [reader, owner, search, billing, ...chained] },
  });
});

type Braid = { owner: string; compiledWhere?: CompiledWhere; from: number };

async function read(traceId: string, braids: Braid[] = [{ owner, compiledWhere: WEB, from: 0 }]) {
  const page = await repo.listSummaryPage({
    authorization: braidedProof({ projectId: reader, braids }),
    traceId,
    limit: 100,
    occurredAtMs: base - 180_000,
  });
  return page.rows.map((each) => `${each.spanId}@${each.ownerProjectId ?? reader}`).toSorted();
}

describe.skipIf(!clickHouseConfigured)("a braided read of a trace held through a span link", () => {
  describe("when the reader and the owner share only the trace id", () => {
    /** @scenario "A reader span sharing only the trace id with the owner shows no owner span" */
    it("shows no owner span, whatever its condition matches", async () => {
      expect(await read(SHARED_ONLY)).toEqual([`reader-root@${reader}`]);
    });
  });

  describe("when a reader span is the parent of an owner span", () => {
    /** @scenario "A reader span linked as parent or child of an owner span shows the matching owner spans" */
    it("shows every matching owner span in the trace, not only the linked one", async () => {
      expect(await read(READER_PARENT)).toEqual(
        [`reader-root@${reader}`, `owner-linked@${owner}`, `owner-deep@${owner}`].toSorted(),
      );
    });
  });

  describe("when an owner span is the parent of a reader span", () => {
    /** @scenario "A reader span linked as parent or child of an owner span shows the matching owner spans" */
    it("shows every matching owner span in the trace, not only the linked one", async () => {
      expect(await read(OWNER_PARENT)).toEqual(
        [`reader-child@${reader}`, `owner-root@${owner}`, `owner-deep@${owner}`].toSorted(),
      );
    });
  });

  describe("when a reader span reuses a known trace id with span ids of its own choosing", () => {
    /** @scenario "A forged reader span reusing a known trace id but an unknown span id shows nothing" */
    it("shows no owner span, only the forged span itself", async () => {
      const spans = await read(FORGED);

      expect(spans).toHaveLength(1);
      expect(spans[0]).toMatch(new RegExp(`^forged-.*@${reader}$`));
    });
  });

  describe("when a reader span carries an empty span id beside an owner root", () => {
    /** @scenario "A reader span with an empty or all-zero span id links to nothing" */
    it("shows no owner span, only the empty-id span itself", async () => {
      expect(await read(EMPTY_ID)).toEqual([`@${reader}`]);
    });
  });

  describe("when a reader span carries the all-zero span id beside owner roots", () => {
    /** @scenario "A reader span with an empty or all-zero span id links to nothing" */
    it("shows no owner span, only the all-zero span itself", async () => {
      expect(await read(ZERO_ID)).toEqual([`${ZERO}@${reader}`]);
    });
  });

  describe("when the call goes from the reader to the owner and back", () => {
    /** @scenario "A call that returns to the reader holds the trace across every hop" */
    it("shows the matching owner spans between and after the reader's hops", async () => {
      expect(await read(RETURNS)).toEqual(
        [
          `reader-first@${reader}`,
          `owner-hop@${owner}`,
          `reader-second@${reader}`,
          `owner-after@${owner}`,
        ].toSorted(),
      );
    });
  });

  describe("when the reader calls an owner that calls a second owner", () => {
    const both: Braid[] = [
      { owner, compiledWhere: WEB, from: 0 },
      { owner: search, from: 0 },
    ];

    /** @scenario "An owner called by another braided owner is held through it" */
    it("shows both owners' matching spans when each braids into the reader", async () => {
      expect(await read(CHAIN, both)).toEqual(
        [`reader-root@${reader}`, `owner-hop@${owner}`, `search-hop@${search}`].toSorted(),
      );
    });

    /** @scenario "An owner whose caller does not braid into the reader stays hidden" */
    it("shows neither when only the second owner braids into the reader", async () => {
      expect(await read(CHAIN, [{ owner: search, from: 0 }])).toEqual([`reader-root@${reader}`]);
    });

    /** @scenario "A project that braids nothing into the reader breaks the chain" */
    it("stops at a project that braids nothing into the reader", async () => {
      expect(await read(BROKEN, both)).toEqual(
        [`reader-root@${reader}`, `owner-hop@${owner}`].toSorted(),
      );
    });

    /** @scenario "A chain that returns to the reader holds every braided owner on it" */
    it("holds every braided owner on a chain that returns to the reader", async () => {
      expect(await read(LOOP, both)).toEqual(
        [`reader-back@${reader}`, `owner-hop@${owner}`, `search-root@${search}`].toSorted(),
      );
    });
  });

  describe("when the chain of braided owners runs past the hop bound", () => {
    /** @scenario "An owner past the hop bound stays hidden" */
    it("shows the owners within the bound and none beyond it", async () => {
      const braids = chained.map((hop) => ({ owner: hop, from: 0 }));
      const within = chained
        .slice(0, BRAID_HELD_MAX_HOPS)
        .map((hop, index) => `hop-${index + 1}@${hop}`);

      expect(await read(DEEP, braids)).toEqual([`reader-root@${reader}`, ...within].toSorted());
    });
  });
});
