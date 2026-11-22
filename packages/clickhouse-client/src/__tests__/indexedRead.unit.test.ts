/**
 * A lookup by id bounded by its id index, over the real client and a driver spy.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import type { IdIndexFlags } from "../idIndexFlags.ts";
import { ID_INDEX_WIDEN_MS, indexedRead, setIdIndexMissLogger } from "../indexedRead.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";
import {
  RESOLVER_RECENT_WINDOW_MS,
  setWindowedReadMetrics,
  type WindowedReadOutcome,
  type WindowFragment,
} from "../windowedRead.ts";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const SHARED_TENANT = "project_on_shared";
const PRIVATE_TENANT = "project_on_private";
const PRIVATE_ORGANIZATION = "org_private";

/** The routed client over a driver whose index answers `index`; `sent` lists each statement. */
function clientWith({ index }: { index: { n: number; fromMs: number; toMs: number } }) {
  const execute = vi.fn<QueryDriver["execute"]>().mockResolvedValue({
    rows: [{ n: String(index.n), fromMs: String(index.fromMs), toMs: String(index.toMs) }],
  });
  const driver: QueryDriver = { execute, insert: async () => {}, command: async () => {} };
  const client = new ClickHouseQueryClient({
    driver,
    tenantGuard: new TenantGuard(),
    privateRoutes: new Map([[PRIVATE_ORGANIZATION, "http://private:8123"]]),
    organizationOf: async (tenantId) =>
      tenantId === PRIVATE_TENANT ? PRIVATE_ORGANIZATION : "org_shared",
  });
  const sent = (): QueryRequest[] => execute.mock.calls.map(([request]) => request);
  return { client, sent };
}

/** The owner's flags: on for the shared target only, answered from memory. */
const sharedOnly: IdIndexFlags = { isOn: ({ target }) => target === "shared" };

let outcomes: { table: string; outcome: WindowedReadOutcome }[];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  outcomes = [];
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });
});

afterEach(() => {
  vi.useRealTimers();
});

/** One lookup of trace `t1` by id alone; `windows` is each window the source read ran with. */
async function lookUp({
  client,
  tenantId,
  idIndex,
}: {
  client: ClickHouseQueryClient;
  tenantId: string;
  idIndex?: IdIndexFlags;
}) {
  const windows: (WindowFragment | null)[] = [];
  const rows = await indexedRead({
    client,
    idIndex,
    tenantId,
    table: "stored_spans",
    index: "stored_spans_id_index",
    key: { TraceId: ["t1"] },
    fallback: "unbounded",
    isEmpty: (result: string[]) => result.length === 0,
    run: async (window) => {
      windows.push(window);
      return [];
    },
  });
  return { rows, windows };
}

describe("indexedRead", () => {
  describe("given the owner's id index is ready on this ClickHouse target and not on another", () => {
    /** @scenario "readers trust the index only once its marker row is written" */
    it("reads through the index only for the tenant on the ready target", async () => {
      const recorded = { fromMs: NOW - 56 * DAY, toMs: NOW - 54 * DAY };
      const { client, sent } = clientWith({ index: { n: 2, ...recorded } });

      const onShared = await lookUp({ client, tenantId: SHARED_TENANT, idIndex: sharedOnly });
      const onPrivate = await lookUp({ client, tenantId: PRIVATE_TENANT, idIndex: sharedOnly });

      expect(sent()).toHaveLength(1);
      expect(sent()[0]?.sql).toContain(
        "FROM stored_spans_id_index WHERE TenantId = {tenantId:String}",
      );
      expect(sent()[0]?.params).toMatchObject({ tenantId: SHARED_TENANT, idIndexKey0: ["t1"] });
      expect(onShared.windows).toHaveLength(1);
      expect(onShared.windows[0]).toMatchObject({
        fromMs: recorded.fromMs - ID_INDEX_WIDEN_MS,
        toMs: recorded.toMs + ID_INDEX_WIDEN_MS,
      });
      expect(onPrivate.windows).toEqual([null]);
      expect(outcomes.map((each) => each.outcome)).toEqual(["index_hit", "unwindowed"]);
    });
  });

  describe("given the index's backfill step has not completed", () => {
    /** @scenario "until the backfill completes, a lookup keeps today's fallback" */
    it("uses the existing windowed fallback rather than trusting the index", async () => {
      const { client, sent } = clientWith({ index: { n: 1, fromMs: NOW, toMs: NOW } });

      const flagOff = await lookUp({
        client,
        tenantId: SHARED_TENANT,
        idIndex: { isOn: () => false },
      });
      const noFlags = await lookUp({ client, tenantId: SHARED_TENANT });

      expect(sent()).toHaveLength(0);
      expect(flagOff.windows).toEqual([null]);
      expect(noFlags.windows).toEqual([null]);
      expect(outcomes.map((each) => each.outcome)).toEqual(["unwindowed", "unwindowed"]);
    });
  });

  describe("given the index's backfill has completed and no record exists for the id", () => {
    /** @scenario "an id the index has never seen probes recent data once and stops" */
    it("probes only the recent window once, never unbounded, and counts an index miss", async () => {
      const { client } = clientWith({ index: { n: 0, fromMs: 0, toMs: 0 } });

      const { rows, windows } = await lookUp({
        client,
        tenantId: SHARED_TENANT,
        idIndex: sharedOnly,
      });

      expect(rows).toEqual([]);
      expect(windows).toHaveLength(1);
      expect(windows[0]).not.toBeNull();
      expect(windows[0]?.fromMs).toBe(NOW - RESOLVER_RECENT_WINDOW_MS);
      expect(outcomes).toEqual([{ table: "stored_spans", outcome: "index_miss" }]);
    });
  });

  describe("given the index misses an id whose rows the recent source still holds", () => {
    /** @scenario "a miss whose source still holds rows is counted as a missing index row" */
    it("returns the rows, counts a found miss and warns once per table without the id", async () => {
      const { client } = clientWith({ index: { n: 0, fromMs: 0, toMs: 0 } });
      const warnings: Record<string, unknown>[] = [];
      setIdIndexMissLogger({ warn: (fields) => warnings.push(fields) });
      const lookUpFound = () =>
        indexedRead({
          client,
          idIndex: sharedOnly,
          tenantId: SHARED_TENANT,
          table: "found_miss_table",
          index: "found_miss_table_id_index",
          key: { TraceId: "t1" },
          fallback: "unbounded",
          isEmpty: (result: string[]) => result.length === 0,
          run: async () => ["span"],
        });

      const first = await lookUpFound();
      await lookUpFound();

      expect(first).toEqual(["span"]);
      expect(outcomes.map((each) => each.outcome)).toEqual([
        "index_miss_found",
        "index_miss_found",
      ]);
      expect(warnings).toEqual([{ table: "found_miss_table", tenantId: SHARED_TENANT }]);
    });
  });

  describe("given a time the caller already has, and a flag on", () => {
    it("reads the hinted window first and asks the index only when it comes back empty", async () => {
      const { client, sent } = clientWith({
        index: { n: 1, fromMs: NOW - 90 * DAY, toMs: NOW - 90 * DAY },
      });
      const windows: (WindowFragment | null)[] = [];

      await indexedRead({
        client,
        idIndex: sharedOnly,
        tenantId: SHARED_TENANT,
        table: "stored_spans",
        index: "stored_spans_id_index",
        key: { TraceId: "t1" },
        hintMs: NOW,
        fallback: "unbounded",
        isEmpty: (result: string[]) => result.length === 0,
        run: async (window) => {
          windows.push(window);
          return windows.length === 1 ? [] : ["span"];
        },
      });

      expect(windows.map((window) => window?.fromMs)).toEqual([
        NOW - 2 * DAY,
        NOW - 90 * DAY - ID_INDEX_WIDEN_MS,
      ]);
      expect(sent()).toHaveLength(1);
      expect(outcomes.map((each) => each.outcome)).toEqual(["index_hit"]);
    });
  });
});
