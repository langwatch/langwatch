import type { StoreContext, StoredState } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  ClickHouseClient,
  QueryOptions,
} from "../client/clickhouseClient";
import {
  type AnyWireColumn,
  createRowCodec,
  type WireCodec,
} from "../codec/rowCodec";
import { type ColumnMap, ch } from "../schema/columns";
import { append, defineTable, replacing } from "../schema/defineTable";
import {
  type ClickHouseReplacingArgs,
  clickhouseReplacing,
  type FoldStateCache,
  ReplaceStoreConfigurationError,
} from "./replaceStore";
import { RowMappingError } from "./rowMapping";

const FOLD_STATE = z.object({
  count: z.number(),
  label: z.string(),
  /** Fills the frozen platform-controlled partition anchor. */
  acceptedAt: z.number(),
});

type FoldState = z.infer<typeof FOLD_STATE>;

const EXPECTED_VERSION = "v1";
const TENANT = "tenant-a";
const KEY = "agg-1";
const CONTEXT: StoreContext = { tenantId: TENANT };
const ACCEPTED_AT = Date.UTC(2026, 6, 1);

const foldTable = defineTable({
  name: "fold_state",
  merge: replacing({ version: "WrittenAt" }),
  sortKey: ["TenantId", "AggregateId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  columns: {
    TenantId: ch.string(),
    AggregateId: ch.string(),
    AcceptedAt: ch.acceptedAt(),
    Count: ch.uint64(),
    Label: ch.string(),
    StateVersion: ch.string(),
    WrittenAt: ch.writtenAt(),
    _retention_days: ch.uint64(),
  },
});

type FoldColumn = (typeof foldTable.columnNames)[number];

const foldColumns = foldTable.columns as ColumnMap;
const wireColumns: AnyWireColumn[] = foldTable.columnNames.map(
  (name) => foldColumns[name]!,
);
const codec = createRowCodec();

function foldState(overrides: Partial<FoldState> = {}): FoldState {
  return { count: 5, label: "rising", acceptedAt: ACCEPTED_AT, ...overrides };
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface InsertCall {
  tenantId: string;
  table: string;
  rows: unknown[][];
  columns: readonly string[];
  target: unknown;
}

interface FakeClient extends ClickHouseClient {
  readonly queryCalls: QueryOptions[];
  readonly insertCalls: InsertCall[];
}

function createFakeClient(
  overrides: {
    query?: (options: QueryOptions) => Promise<{
      rows: unknown[][];
      header?: { names: string[]; types: string[] };
    }>;
    onInsert?: () => void;
  } = {},
): FakeClient {
  const queryCalls: QueryOptions[] = [];
  const insertCalls: InsertCall[] = [];

  return {
    queryCalls,
    insertCalls,
    async query(options) {
      queryCalls.push(options);
      if (overrides.query) return overrides.query(options);
      return { rows: [] };
    },
    stream() {
      throw new Error("not used by clickhouseReplacing");
    },
    async insert(options) {
      overrides.onInsert?.();
      insertCalls.push(options as InsertCall);
    },
    async close() {},
  };
}

interface FakeCache extends FoldStateCache<FoldState> {
  readonly entries: Map<string, StoredState<FoldState>>;
  readonly setCalls: Array<{ key: string; stored: StoredState<FoldState> }>;
  readonly deleteCalls: string[];
}

function createFakeCache(
  overrides: {
    onSet?: () => void;
    failSet?: boolean;
    failDelete?: boolean;
  } = {},
): FakeCache {
  const entries = new Map<string, StoredState<FoldState>>();
  const setCalls: FakeCache["setCalls"] = [];
  const deleteCalls: string[] = [];

  return {
    entries,
    setCalls,
    deleteCalls,
    async get(key) {
      return entries.get(key) ?? null;
    },
    async set(key, stored) {
      overrides.onSet?.();
      setCalls.push({ key, stored });
      if (overrides.failSet) throw new Error("cache unreachable");
      entries.set(key, stored);
    },
    async delete(key) {
      deleteCalls.push(key);
      if (overrides.failDelete) throw new Error("cache unreachable");
      entries.delete(key);
    },
  };
}

function buildStore(
  client: ClickHouseClient,
  overrides: Partial<
    ClickHouseReplacingArgs<FoldState, typeof foldTable.columns>
  > = {},
) {
  return clickhouseReplacing<FoldState, typeof foldTable.columns>({
    client,
    table: foldTable,
    version: EXPECTED_VERSION,
    key: "AggregateId",
    stateVersionColumn: "StateVersion",
    state: FOLD_STATE,
    ...overrides,
  });
}

/** One stored row, encoded exactly as the wire would carry it back. */
function storedRow(
  overrides: { count?: bigint; label?: string; stateVersion?: string } = {},
) {
  const rows = codec.encodeRows({
    columns: wireColumns,
    columnNames: foldTable.columnNames,
    rows: [
      {
        TenantId: TENANT,
        AggregateId: KEY,
        AcceptedAt: new Date(ACCEPTED_AT),
        Count: overrides.count ?? 9n,
        Label: overrides.label ?? "steady",
        StateVersion: overrides.stateVersion ?? EXPECTED_VERSION,
        WrittenAt: new Date(ACCEPTED_AT),
        _retention_days: 308n,
      },
    ],
  });
  return { rows, header: wireHeader() };
}

/** The state `storedRow()` decodes to. */
const STORED_STATE: FoldState = {
  count: 9,
  label: "steady",
  acceptedAt: ACCEPTED_AT,
};

function wireHeader(): { names: string[]; types: string[] } {
  return {
    names: [...foldTable.columnNames],
    types: foldTable.columnNames.map((name) => foldColumns[name]!.chType),
  };
}

/** A stored row with one cell replaced by something that will not decode. */
function corruptedRow(column: FoldColumn, cell: unknown) {
  const { rows, header } = storedRow();
  rows[0]![foldTable.columnNames.indexOf(column)] = cell;
  return { rows, header };
}

function cellOf(call: InsertCall, column: string): unknown {
  return call.rows[0]?.[call.columns.indexOf(column)];
}

// ---------------------------------------------------------------------------
// Query inspection — the read binds identifiers, so nothing is interpolated
// ---------------------------------------------------------------------------

const IDENTIFIER_PLACEHOLDER = /\{([A-Za-z0-9_]+):Identifier\}/g;

/** The names behind a query's identifier placeholders; throws on an unbound one. */
function boundIdentifiers(call: QueryOptions): Set<string> {
  const params = call.params ?? {};
  const names = new Set<string>();
  for (const [, key] of call.sql.matchAll(IDENTIFIER_PLACEHOLDER)) {
    const value = params[key!];
    if (typeof value !== "string") {
      throw new Error(`identifier placeholder "${key}" resolves to nothing`);
    }
    names.add(value);
  }
  return names;
}

function resolveIdentifiers(call: QueryOptions): string {
  const params = call.params ?? {};
  return call.sql.replace(IDENTIFIER_PLACEHOLDER, (_, key: string) =>
    String(params[key]),
  );
}

function valueParams(call: QueryOptions): Record<string, unknown> {
  const params = { ...(call.params ?? {}) };
  for (const [, key] of call.sql.matchAll(IDENTIFIER_PLACEHOLDER)) {
    delete params[key!];
  }
  return params;
}

// ---------------------------------------------------------------------------

describe("given clickhouseReplacing()", () => {
  describe("when the table does not declare a replacing merge strategy", () => {
    it("refuses at construction rather than at the first query", () => {
      const appendOnlyTable = defineTable({
        name: "append_only",
        merge: append(),
        sortKey: ["TenantId", "Id"],
        partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
        tenant: ["TenantId"],
        columns: {
          TenantId: ch.string(),
          Id: ch.string(),
          AcceptedAt: ch.acceptedAt(),
          StateVersion: ch.string(),
        },
      });

      expect(() =>
        clickhouseReplacing<FoldState, typeof appendOnlyTable.columns>({
          client: createFakeClient(),
          table: appendOnlyTable,
          version: EXPECTED_VERSION,
          key: "Id",
          stateVersionColumn: "StateVersion",
          state: FOLD_STATE,
        }),
      ).toThrow(ReplaceStoreConfigurationError);
    });
  });

  describe("when the sort key does not start with the tenant and key columns", () => {
    /** @scenario a filtered column that is not in the sort key is refused */
    it("refuses at construction, a read bound on those two alone being a scan", () => {
      const lateKeyTable = defineTable({
        name: "fold_state_late_key",
        merge: replacing({ version: "WrittenAt" }),
        sortKey: ["TenantId", "AcceptedAt", "AggregateId"],
        partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
        tenant: ["TenantId"],
        columns: foldTable.columns,
      });

      expect(() =>
        clickhouseReplacing<FoldState, typeof lateKeyTable.columns>({
          client: createFakeClient(),
          table: lateKeyTable,
          version: EXPECTED_VERSION,
          key: "AggregateId",
          stateVersionColumn: "StateVersion",
          state: FOLD_STATE,
        }),
      ).toThrow(/sort key/);
    });
  });

  describe("when the table declares more than one tenant column", () => {
    const TWO_TENANT_STATE = FOLD_STATE.extend({ organizationId: z.string() });
    const twoTenantTable = defineTable({
      name: "fold_state_two_tenants",
      merge: replacing({ version: "WrittenAt" }),
      sortKey: ["ProjectId", "AggregateId", "OrganizationId"],
      partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
      tenant: ["OrganizationId", "ProjectId"],
      columns: {
        OrganizationId: ch.string(),
        ProjectId: ch.string(),
        AggregateId: ch.string(),
        AcceptedAt: ch.acceptedAt(),
        Count: ch.uint64(),
        Label: ch.string(),
        StateVersion: ch.string(),
        WrittenAt: ch.writtenAt(),
      },
    });

    it("refuses at construction rather than picking one of them", () => {
      expect(() =>
        clickhouseReplacing<
          z.infer<typeof TWO_TENANT_STATE>,
          typeof twoTenantTable.columns
        >({
          client: createFakeClient(),
          table: twoTenantTable,
          version: EXPECTED_VERSION,
          key: "AggregateId",
          stateVersionColumn: "StateVersion",
          state: TWO_TENANT_STATE,
        }),
      ).toThrow(ReplaceStoreConfigurationError);
    });

    it("accepts the table once the caller names which one scopes the read", () => {
      expect(() =>
        clickhouseReplacing<
          z.infer<typeof TWO_TENANT_STATE>,
          typeof twoTenantTable.columns
        >({
          client: createFakeClient(),
          table: twoTenantTable,
          version: EXPECTED_VERSION,
          key: "AggregateId",
          stateVersionColumn: "StateVersion",
          state: TWO_TENANT_STATE,
          tenant: "ProjectId",
        }),
      ).not.toThrow();
    });
  });

  describe("when the table declares a column nothing can fill", () => {
    it("refuses at construction, naming the column, rather than writing a short row", () => {
      const extraColumnTable = defineTable({
        name: "fold_state_extra",
        merge: replacing({ version: "WrittenAt" }),
        sortKey: ["TenantId", "AggregateId"],
        partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
        tenant: ["TenantId"],
        columns: { ...foldTable.columns, Notes: ch.string() },
      });

      expect(() =>
        clickhouseReplacing<FoldState, typeof extraColumnTable.columns>({
          client: createFakeClient(),
          table: extraColumnTable,
          version: EXPECTED_VERSION,
          key: "AggregateId",
          stateVersionColumn: "StateVersion",
          state: FOLD_STATE,
        }),
      ).toThrow(RowMappingError);
    });
  });

  describe("when neither a state schema nor a row mapping is given", () => {
    it("refuses at construction, having no way to map state to columns", () => {
      expect(() =>
        clickhouseReplacing<FoldState, typeof foldTable.columns>({
          client: createFakeClient(),
          table: foldTable,
          version: EXPECTED_VERSION,
          key: "AggregateId",
          stateVersionColumn: "StateVersion",
        }),
      ).toThrow(ReplaceStoreConfigurationError);
    });
  });

  describe("when an explicit row mapping is given instead of a state schema", () => {
    it("maps both directions through it rather than deriving one", async () => {
      const client = createFakeClient({ query: async () => storedRow() });
      const store = clickhouseReplacing<FoldState, typeof foldTable.columns>({
        client,
        table: foldTable,
        version: EXPECTED_VERSION,
        key: "AggregateId",
        stateVersionColumn: "StateVersion",
        row: {
          toRow: (state, context) => ({
            TenantId: context.tenantId,
            AggregateId: context.key,
            AcceptedAt: new Date(state.acceptedAt),
            Count: BigInt(state.count),
            Label: `mapped:${state.label}`,
            StateVersion: context.version,
            WrittenAt: context.writtenAt,
            _retention_days: BigInt(context.retentionDays),
          }),
          fromRow: (row) => ({
            count: Number(row.Count),
            label: `unmapped:${row.Label}`,
            acceptedAt: row.AcceptedAt.getTime(),
          }),
        },
      });

      const read = await store.read(KEY, CONTEXT);
      expect(read).toEqual({
        kind: "found",
        stored: {
          state: { ...STORED_STATE, label: "unmapped:steady" },
          version: EXPECTED_VERSION,
        },
      });

      await store.write(
        KEY,
        { state: foldState(), version: EXPECTED_VERSION },
        CONTEXT,
      );
      expect(cellOf(client.insertCalls[0]!, "Label")).toBe("mapped:rising");
    });
  });

  describe("when reading a key with no stored row", () => {
    /** @scenario an aggregate with no record at all is reported absent */
    it("reports absent", async () => {
      const store = buildStore(
        createFakeClient({ query: async () => ({ rows: [] }) }),
      );

      expect(await store.read(KEY, CONTEXT)).toEqual({ kind: "absent" });
    });
  });

  describe("when reading a key whose stored row matches the expected version", () => {
    it("decodes the whole row into state and reports it as found", async () => {
      const client = createFakeClient({
        query: async () => storedRow({ count: 9n, label: "steady" }),
      });
      const store = buildStore(client);

      expect(await store.read(KEY, CONTEXT)).toEqual({
        kind: "found",
        stored: { state: STORED_STATE, version: EXPECTED_VERSION },
      });
    });

    it("asks for sequential consistency, so a read never races its own write's replica", async () => {
      const client = createFakeClient();
      const store = buildStore(client);

      await store.read(KEY, CONTEXT);

      expect(client.queryCalls).toHaveLength(1);
      expect(client.queryCalls[0]?.settings).toMatchObject({
        select_sequential_consistency: 1,
      });
    });

    it("binds the table and every column as identifier parameters, interpolating none", async () => {
      const client = createFakeClient();
      const store = buildStore(client);

      await store.read(KEY, CONTEXT);

      const call = client.queryCalls[0]!;
      expect(boundIdentifiers(call)).toEqual(
        new Set([foldTable.name, ...foldTable.columnNames]),
      );
      expect(call.sql).not.toContain(foldTable.name);
      for (const column of foldTable.columnNames) {
        expect(call.sql).not.toContain(column);
      }
    });

    /** @scenario every read filters on the tenant first */
    it("selects every column of one row, scoped to the tenant and key, newest by merge version", async () => {
      const client = createFakeClient();
      const store = buildStore(client);

      await store.read(KEY, CONTEXT);

      const call = client.queryCalls[0]!;
      const sql = resolveIdentifiers(call);
      expect(sql).toContain(
        `SELECT ${foldTable.columnNames.join(", ")} FROM fold_state`,
      );
      expect(sql).toContain(
        "WHERE TenantId = {tenantId:String} AND AggregateId = {key0:String}",
      );
      expect(sql).toContain("ORDER BY WrittenAt DESC LIMIT 1");
      expect(valueParams(call)).toEqual({ tenantId: TENANT, key0: KEY });
    });
  });

  describe("when reading a key whose stored row was written under an older state version", () => {
    /** @scenario a record in a shape this build cannot read is reported as found and refused */
    /** @scenario a fold with production rows and no pin fails its version gate on every row */
    it("reports undecodable with the stored version, never absent", async () => {
      const client = createFakeClient({
        query: async () => storedRow({ stateVersion: "v0-legacy" }),
      });
      const store = buildStore(client);

      expect(await store.read(KEY, CONTEXT)).toEqual({
        kind: "undecodable",
        storedVersion: "v0-legacy",
      });
    });

    it("never decodes the row, so a stale shape cannot coerce into the current one", async () => {
      // The stale row would decode cleanly under today's columns. If the gate
      // ran after the decode, a coercing schema would turn a genuinely stale
      // payload into a plausible wrong one on its way to being discarded.
      const client = createFakeClient({
        query: async () => storedRow({ stateVersion: "v0-legacy", count: 1n }),
      });
      const decodeRows = vi.fn(() => {
        throw new Error("the row must not be decoded on a version mismatch");
      });
      const store = buildStore(client, {
        codec: {
          readFormat: "fake",
          writeFormat: "fake",
          decodeRows: decodeRows as unknown as WireCodec["decodeRows"],
          encodeRows: (() => []) as unknown as WireCodec["encodeRows"],
        },
      });

      expect(await store.read(KEY, CONTEXT)).toEqual({
        kind: "undecodable",
        storedVersion: "v0-legacy",
      });
      expect(decodeRows).not.toHaveBeenCalled();
    });

    it("reports undecodable with a cause when the version cell itself will not decode", async () => {
      const client = createFakeClient({
        // A `String` column handed a JSON number: the version cannot be read
        // at all, which still must not read as absent.
        query: async () => corruptedRow("StateVersion", 42),
      });
      const store = buildStore(client);

      const result = await store.read(KEY, CONTEXT);

      expect(result.kind).toBe("undecodable");
      expect(
        (result as { storedVersion?: string }).storedVersion,
      ).toBeUndefined();
      expect((result as { cause?: unknown }).cause).toBeDefined();
    });
  });

  describe("when the stored row will not decode despite a matching version", () => {
    it("reports undecodable with a cause instead of throwing", async () => {
      const client = createFakeClient({
        query: async () => corruptedRow("Count", "not-a-number"),
      });
      const store = buildStore(client);

      const result = await store.read(KEY, CONTEXT);

      expect(result.kind).toBe("undecodable");
      expect((result as { storedVersion?: string }).storedVersion).toBe(
        EXPECTED_VERSION,
      );
      expect((result as { cause?: unknown }).cause).toBeDefined();
    });
  });

  describe("when writing state for a key", () => {
    it("inserts one durable, retry-safe row carrying the tenant, key, state and version", async () => {
      const client = createFakeClient();
      const store = buildStore(client);

      await store.write(
        KEY,
        {
          state: foldState({ count: 5, label: "rising" }),
          version: EXPECTED_VERSION,
        },
        CONTEXT,
      );

      expect(client.insertCalls).toHaveLength(1);
      const call = client.insertCalls[0]!;
      expect(call.table).toBe(foldTable.name);
      expect(call.tenantId).toBe(TENANT);
      expect(call.target).toEqual({ kind: "replacing" });
      expect(call.columns).toEqual(foldTable.columnNames);
      expect(cellOf(call, "TenantId")).toBe(TENANT);
      expect(cellOf(call, "AggregateId")).toBe(KEY);
      expect(cellOf(call, "Count")).toBe("5");
      expect(cellOf(call, "Label")).toBe("rising");
      expect(cellOf(call, "StateVersion")).toBe(EXPECTED_VERSION);
    });

    it("stamps a fresh writtenAt on each write, so a later write outranks an earlier one", async () => {
      const client = createFakeClient();
      const store = buildStore(client);
      const first = new Date("2026-07-01T00:00:00.000Z");
      const second = new Date("2026-07-01T00:00:01.500Z");
      const stored = { state: foldState(), version: EXPECTED_VERSION };

      vi.useFakeTimers();
      try {
        vi.setSystemTime(first);
        await store.write(KEY, stored, CONTEXT);
        vi.setSystemTime(second);
        await store.write(KEY, stored, CONTEXT);
      } finally {
        vi.useRealTimers();
      }

      const stampedAt = (call: InsertCall) =>
        foldColumns.WrittenAt!.decode(cellOf(call, "WrittenAt")) as Date;
      expect(stampedAt(client.insertCalls[0]!)).toEqual(first);
      expect(stampedAt(client.insertCalls[1]!)).toEqual(second);
    });

    /** @scenario a partition anchor is not re-stamped on every write */
    it("leaves the frozen partition anchor where the state put it, write after write", async () => {
      const client = createFakeClient();
      const store = buildStore(client);
      const stored = { state: foldState(), version: EXPECTED_VERSION };

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
        await store.write(KEY, stored, CONTEXT);
        vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
        await store.write(KEY, stored, CONTEXT);
      } finally {
        vi.useRealTimers();
      }

      const anchorOf = (call: InsertCall) =>
        foldColumns.AcceptedAt!.decode(cellOf(call, "AcceptedAt")) as Date;
      expect(anchorOf(client.insertCalls[0]!)).toEqual(new Date(ACCEPTED_AT));
      expect(anchorOf(client.insertCalls[1]!)).toEqual(new Date(ACCEPTED_AT));
    });

    /** @scenario retention is stamped from the kind of data a record holds */
    /** @scenario a fold with no retention answer still keeps records for a bounded time */
    it("stamps the retention the caller asked for, falling back to the store's own", async () => {
      const client = createFakeClient();
      const store = buildStore(client, { retentionDays: 90 });
      const stored = { state: foldState(), version: EXPECTED_VERSION };

      await store.write(KEY, stored, { tenantId: TENANT, retentionDays: 30 });
      await store.write(KEY, stored, CONTEXT);

      expect(cellOf(client.insertCalls[0]!, "_retention_days")).toBe("30");
      expect(cellOf(client.insertCalls[1]!, "_retention_days")).toBe("90");
    });
  });

  describe("when the client's query call itself fails", () => {
    it("propagates the failure rather than swallowing it as undecodable", async () => {
      const client = createFakeClient({
        query: async () => {
          throw new Error("connection refused");
        },
      });
      const store = buildStore(client);

      await expect(store.read(KEY, CONTEXT)).rejects.toThrow(
        "connection refused",
      );
    });
  });

  describe("when constructed twice for the same table", () => {
    it("does not share mutable state between the two instances", async () => {
      const clientA = createFakeClient();
      const clientB = createFakeClient();
      const storeA = buildStore(clientA);
      buildStore(clientB);

      await storeA.write(
        KEY,
        { state: foldState(), version: EXPECTED_VERSION },
        CONTEXT,
      );

      expect(clientA.insertCalls).toHaveLength(1);
      expect(clientB.insertCalls).toHaveLength(0);
    });
  });

  describe("when a custom codec is injected", () => {
    it("routes both reads and writes through it rather than a default one", async () => {
      const client = createFakeClient({ query: async () => storedRow() });
      const decodeRows = vi.fn(() => [
        {
          TenantId: TENANT,
          AggregateId: KEY,
          AcceptedAt: new Date(ACCEPTED_AT),
          Count: 4n,
          Label: "decoded-by-fake-codec",
          StateVersion: EXPECTED_VERSION,
          WrittenAt: new Date(ACCEPTED_AT),
          _retention_days: 308n,
        },
      ]);
      const encodeRows = vi.fn(() => [["encoded-by-fake-codec"]]);
      const store = buildStore(client, {
        // `decodeRows`/`encodeRows` are generic in the row type; a `vi.fn`
        // cannot be, so the mocks are cast into the slot.
        codec: {
          readFormat: "fake",
          writeFormat: "fake",
          decodeRows: decodeRows as unknown as WireCodec["decodeRows"],
          encodeRows: encodeRows as unknown as WireCodec["encodeRows"],
        },
      });

      expect(await store.read(KEY, CONTEXT)).toEqual({
        kind: "found",
        stored: {
          state: {
            count: 4,
            label: "decoded-by-fake-codec",
            acceptedAt: ACCEPTED_AT,
          },
          version: EXPECTED_VERSION,
        },
      });

      await store.write(
        KEY,
        { state: foldState(), version: EXPECTED_VERSION },
        CONTEXT,
      );
      expect(encodeRows).toHaveBeenCalledOnce();
      expect(client.insertCalls[0]?.rows).toEqual([["encoded-by-fake-codec"]]);
    });
  });
});

describe("given clickhouseReplacing() with a cache in front of the table", () => {
  describe("when the cached entry was written under the expected version", () => {
    /** @scenario a cached entry is served without reading the durable store */
    it("serves it without querying the table at all", async () => {
      const client = createFakeClient({ query: async () => storedRow() });
      const cache = createFakeCache();
      const cached = {
        state: foldState({ count: 3, label: "cached" }),
        version: EXPECTED_VERSION,
      };
      cache.entries.set(KEY, cached);
      const store = buildStore(client, { cache });

      expect(await store.read(KEY, CONTEXT)).toEqual({
        kind: "found",
        stored: cached,
      });
      expect(client.queryCalls).toHaveLength(0);
    });
  });

  describe("when the cached entry's version disagrees with this build's", () => {
    /** @scenario a cache entry written under an older state shape is passed over while still warm */
    it("drops the entry and rereads the table, so the key is not stuck on a shape it cannot use", async () => {
      const client = createFakeClient({ query: async () => storedRow() });
      const cache = createFakeCache();
      cache.entries.set(KEY, {
        state: foldState({ label: "legacy" }),
        version: "v0-legacy",
      });
      const store = buildStore(client, { cache });

      const result = await store.read(KEY, CONTEXT);

      expect(cache.deleteCalls).toEqual([KEY]);
      expect(client.queryCalls).toHaveLength(1);
      expect(result).toEqual({
        kind: "found",
        stored: { state: STORED_STATE, version: EXPECTED_VERSION },
      });
      expect(cache.entries.get(KEY)).toEqual({
        state: STORED_STATE,
        version: EXPECTED_VERSION,
      });
    });
  });

  describe("when the cache has no entry for the key", () => {
    /** @scenario a cache miss falls through to the durable store */
    /** @scenario a cold cache recovers from the fold's own row, never from the event log */
    it("falls through to the table and caches what it found", async () => {
      const client = createFakeClient({
        query: async () => storedRow({ count: 9n }),
      });
      const cache = createFakeCache();
      const store = buildStore(client, { cache });

      await store.read(KEY, CONTEXT);

      expect(client.queryCalls).toHaveLength(1);
      // The only query issued targets the fold's own table — recovery never
      // reaches for the event log, which this store has no reference to at all.
      expect(resolveIdentifiers(client.queryCalls[0]!)).toContain(
        `FROM ${foldTable.name}`,
      );
      expect(cache.entries.get(KEY)).toEqual({
        state: STORED_STATE,
        version: EXPECTED_VERSION,
      });
    });

    it("caches nothing when the table has no row either", async () => {
      const client = createFakeClient({ query: async () => ({ rows: [] }) });
      const cache = createFakeCache();
      const store = buildStore(client, { cache });

      await store.read(KEY, CONTEXT);

      expect(cache.setCalls).toHaveLength(0);
    });
  });

  describe("when a write succeeds", () => {
    /** @scenario the durable store is written before the cache, always */
    /** @scenario a durable write resolves only once the block has landed */
    it("populates the cache, after the row is durable and never before", async () => {
      const order: string[] = [];
      const client = createFakeClient({ onInsert: () => order.push("insert") });
      const cache = createFakeCache({ onSet: () => order.push("cache") });
      const store = buildStore(client, { cache });
      const stored = { state: foldState(), version: EXPECTED_VERSION };

      await store.write(KEY, stored, CONTEXT);

      expect(order).toEqual(["insert", "cache"]);
      expect(cache.entries.get(KEY)).toEqual(stored);
    });
  });

  describe("when the cache write fails after a durable insert", () => {
    /** @scenario a failed cache write deletes the key rather than leaving what is there */
    it("deletes the key rather than leaving a stale entry the next read would serve", async () => {
      const client = createFakeClient();
      const cache = createFakeCache({ failSet: true });
      cache.entries.set(KEY, {
        state: foldState({ label: "superseded" }),
        version: EXPECTED_VERSION,
      });
      const store = buildStore(client, { cache });

      await store.write(
        KEY,
        { state: foldState(), version: EXPECTED_VERSION },
        CONTEXT,
      );

      expect(client.insertCalls).toHaveLength(1);
      expect(cache.deleteCalls).toEqual([KEY]);
      expect(cache.entries.has(KEY)).toBe(false);
    });

    it("still completes the write when the delete fails too, the row already being durable", async () => {
      const client = createFakeClient();
      const cache = createFakeCache({ failSet: true, failDelete: true });
      const store = buildStore(client, { cache });

      await expect(
        store.write(
          KEY,
          { state: foldState(), version: EXPECTED_VERSION },
          CONTEXT,
        ),
      ).resolves.toBeUndefined();
      expect(client.insertCalls).toHaveLength(1);
    });
  });

  describe("when the cache resolves no entry because its own stored bytes could not be read back", () => {
    /** @scenario an unreadable cache entry is a miss, not a failure */
    it("is indistinguishable from a plain miss, and falls through to the table without failing", async () => {
      const client = createFakeClient({
        query: async () => storedRow({ count: 9n }),
      });
      // `FoldStateCache.get()` returns `null` for both "no entry" and "entry
      // present but this cache implementation could not decode it" — the
      // distinction, if any, is the cache's own concern, never the store's.
      const cache = createFakeCache();
      const store = buildStore(client, { cache });

      const result = await store.read(KEY, CONTEXT);

      expect(result).toEqual({
        kind: "found",
        stored: { state: STORED_STATE, version: EXPECTED_VERSION },
      });
      expect(client.queryCalls).toHaveLength(1);
    });
  });

  describe("when the cache cannot be reached at all", () => {
    /** @scenario an unreachable cache does not fail a delivery */
    it("falls through to the durable store and the read still succeeds", async () => {
      const client = createFakeClient({
        query: async () => storedRow({ count: 9n }),
      });
      const cache = createFakeCache();
      cache.get = () => Promise.reject(new Error("cache unreachable"));
      const store = buildStore(client, { cache });

      const result = await store.read(KEY, CONTEXT);

      expect(result).toEqual({
        kind: "found",
        stored: { state: STORED_STATE, version: EXPECTED_VERSION },
      });
      expect(client.queryCalls).toHaveLength(1);
    });
  });

  describe("when the lane serving this aggregate moves to a different consumer", () => {
    /** @scenario a lane that moves to another consumer does not serve the first one's cached state */
    it("does not serve the first consumer's cached entry once another has advanced the aggregate", async () => {
      const client = createFakeClient({
        query: async () => storedRow({ count: 9n }),
      });
      // The cache is shared infrastructure (Redis, not a per-process map), so
      // two consumers of the same lane read and write through the one entry.
      const sharedCache = createFakeCache();
      const firstConsumer = buildStore(client, { cache: sharedCache });
      const secondConsumer = buildStore(client, { cache: sharedCache });

      await firstConsumer.read(KEY, CONTEXT);
      const advanced = {
        state: foldState({ count: 41, label: "advanced" }),
        version: EXPECTED_VERSION,
      };
      await secondConsumer.write(KEY, advanced, CONTEXT);

      expect(await firstConsumer.read(KEY, CONTEXT)).toEqual({
        kind: "found",
        stored: advanced,
      });
    });
  });
});

describe("given a table whose engine key is composite", () => {
  const compositeState = z.object({
    runId: z.string(),
    experimentId: z.string(),
    startedAt: z.number(),
    completed: z.number(),
  });

  const runsTable = defineTable({
    name: "experiment_runs",
    merge: replacing({ version: "UpdatedAt" }),
    sortKey: ["TenantId", "RunId", "ExperimentId"],
    partition: { by: "toYYYYMM(StartedAt)", column: "StartedAt" },
    tenant: ["TenantId"],
    columns: {
      TenantId: ch.string(),
      RunId: ch.string(),
      ExperimentId: ch.string(),
      StartedAt: ch.acceptedAt(),
      Completed: ch.uint32(),
      Version: ch.string(),
      UpdatedAt: ch.writtenAt(),
    },
  });

  function buildCompositeStore(client: ClickHouseClient) {
    return clickhouseReplacing({
      client,
      table: runsTable,
      state: compositeState,
      version: "v1",
      key: {
        columns: ["RunId", "ExperimentId"],
        split: (key: string) => key.split(":"),
      },
      stateVersionColumn: "Version",
    });
  }

  /** @scenario a composite engine key is bound column by column */
  it("binds every key column, so two rows sharing one part stay distinct", async () => {
    const client = createFakeClient();
    const store = buildCompositeStore(client);

    await store.read("run-1:exp-1", CONTEXT);

    const call = client.queryCalls[0]!;
    expect(resolveIdentifiers(call)).toContain(
      "WHERE TenantId = {tenantId:String} AND RunId = {key0:String} AND ExperimentId = {key1:String}",
    );
    expect(valueParams(call)).toEqual({
      tenantId: TENANT,
      key0: "run-1",
      key1: "exp-1",
    });
  });

  it("refuses a key that does not split into one part per column", async () => {
    const store = buildCompositeStore(createFakeClient());

    await expect(store.read("run-1", CONTEXT)).rejects.toThrow(
      ReplaceStoreConfigurationError,
    );
  });

  it("refuses at construction when the key columns are not the sort key's front", () => {
    expect(() =>
      clickhouseReplacing({
        client: createFakeClient(),
        table: runsTable,
        state: compositeState,
        version: "v1",
        key: { columns: ["ExperimentId"], split: (key: string) => [key] },
        stateVersionColumn: "Version",
      }),
    ).toThrow(ReplaceStoreConfigurationError);
  });
});

describe("given clickhouseReplacing() with a declared read window", () => {
  // A time-leading sort key is only seekable behind a declared window
  // (ADR-109 decision 5): `AcceptedAt` fronts the key, ahead of the fold's
  // own `AggregateId`.
  const windowedTable = defineTable({
    name: "fold_state_windowed",
    merge: replacing({ version: "WrittenAt" }),
    sortKey: ["TenantId", "AcceptedAt", "AggregateId"],
    partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
    tenant: ["TenantId"],
    columns: foldTable.columns,
  });

  function buildWindowedStore(client: ClickHouseClient) {
    return clickhouseReplacing<FoldState, typeof windowedTable.columns>({
      client,
      table: windowedTable,
      version: EXPECTED_VERSION,
      key: "AggregateId",
      stateVersionColumn: "StateVersion",
      state: FOLD_STATE,
      readWindow: {
        column: "AcceptedAt",
        lookbackMs: 30 * 24 * 60 * 60 * 1000,
      },
    });
  }

  /** @scenario a declared read window bounds the store read */
  it("bounds the read on the window column when the row is found within it", async () => {
    const client = createFakeClient({ query: async () => storedRow() });
    const store = buildWindowedStore(client);

    await store.read(KEY, CONTEXT);

    expect(client.queryCalls).toHaveLength(1);
    const sql = resolveIdentifiers(client.queryCalls[0]!);
    expect(sql).toContain("AND AcceptedAt >= {windowFrom:DateTime64(3)}");
  });

  /** @scenario a windowed miss retries unwindowed before treating the aggregate as new */
  it("retries unwindowed before reporting the aggregate absent", async () => {
    let calls = 0;
    const client = createFakeClient({
      query: async () => {
        calls++;
        return calls === 1 ? { rows: [] } : storedRow();
      },
    });
    const store = buildWindowedStore(client);

    const result = await store.read(KEY, CONTEXT);

    expect(client.queryCalls).toHaveLength(2);
    expect(resolveIdentifiers(client.queryCalls[0]!)).toContain("windowFrom");
    expect(resolveIdentifiers(client.queryCalls[1]!)).not.toContain(
      "windowFrom",
    );
    expect(result).toEqual({
      kind: "found",
      stored: { state: STORED_STATE, version: EXPECTED_VERSION },
    });
  });

  /** @scenario a row the store found but refused is not read again unwindowed */
  it("does not retry unwindowed once the windowed query found an undecodable row", async () => {
    const client = createFakeClient({
      query: async () => storedRow({ stateVersion: "v0-legacy" }),
    });
    const store = buildWindowedStore(client);

    const result = await store.read(KEY, CONTEXT);

    expect(client.queryCalls).toHaveLength(1);
    expect(result).toEqual({ kind: "undecodable", storedVersion: "v0-legacy" });
  });

  function buildTrustingStore(
    client: ClickHouseClient,
    onTrustedAbsentMiss?: () => void,
  ) {
    return clickhouseReplacing<FoldState, typeof windowedTable.columns>({
      client,
      table: windowedTable,
      version: EXPECTED_VERSION,
      key: "AggregateId",
      stateVersionColumn: "StateVersion",
      state: FOLD_STATE,
      readWindow: {
        column: "AcceptedAt",
        lookbackMs: 30 * 24 * 60 * 60 * 1000,
        trustAbsentMiss: true,
        onTrustedAbsentMiss,
      },
    });
  }

  /** @scenario a trusted windowed absence folds from init with a single read */
  it("reports a trusted windowed miss absent without the unwindowed retry", async () => {
    let skipped = 0;
    const client = createFakeClient({ query: async () => ({ rows: [] }) });
    const store = buildTrustingStore(client, () => skipped++);

    const result = await store.read(KEY, CONTEXT);

    expect(client.queryCalls).toHaveLength(1);
    expect(resolveIdentifiers(client.queryCalls[0]!)).toContain("windowFrom");
    expect(result).toEqual({ kind: "absent" });
    expect(skipped).toBe(1);
  });

  /** @scenario a trusted store still refuses a row it cannot decode */
  it("keeps reporting undecodable, uncounted, when the windowed query finds a refused row", async () => {
    let skipped = 0;
    const client = createFakeClient({
      query: async () => storedRow({ stateVersion: "v0-legacy" }),
    });
    const store = buildTrustingStore(client, () => skipped++);

    const result = await store.read(KEY, CONTEXT);

    expect(client.queryCalls).toHaveLength(1);
    expect(result).toEqual({ kind: "undecodable", storedVersion: "v0-legacy" });
    expect(skipped).toBe(0);
  });

  /** @scenario absence is only trusted where it is declared */
  it("keeps the unwindowed retry for a windowed store that does not declare trust", async () => {
    const client = createFakeClient({ query: async () => ({ rows: [] }) });
    const store = buildWindowedStore(client);

    const result = await store.read(KEY, CONTEXT);

    expect(client.queryCalls).toHaveLength(2);
    expect(resolveIdentifiers(client.queryCalls[1]!)).not.toContain(
      "windowFrom",
    );
    expect(result).toEqual({ kind: "absent" });
  });
});
