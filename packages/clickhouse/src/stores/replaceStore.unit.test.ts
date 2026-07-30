import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  ClickHouseClient,
  QueryOptions,
} from "../client/clickhouseClient";
import type { WireCodec } from "../codec/rowCodec";
import { ch } from "../schema/columns";
import { defineTable, replacing } from "../schema/defineTable";
import {
  createReplaceStore,
  ReplaceStoreConfigurationError,
  type ReplaceStoreArgs,
} from "./replaceStore";

interface FoldState {
  readonly count: number;
}

const STATE_SCHEMA = z.object({ count: z.number() });
const EXPECTED_VERSION = "v1";

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
    State: ch.json(STATE_SCHEMA),
    DeliverySeq: ch.uint64(),
    StateVersion: ch.string(),
    WrittenAt: ch.writtenAt(),
  },
});

interface FakeClient extends ClickHouseClient {
  readonly queryCalls: QueryOptions[];
  readonly insertCalls: Array<{
    tenantId: string;
    table: string;
    rows: unknown[][];
    columns: readonly string[];
    target: unknown;
  }>;
}

function createFakeClient(overrides: {
  query?: (options: QueryOptions) => Promise<{
    rows: unknown[][];
    header?: { names: string[]; types: string[] };
  }>;
} = {}): FakeClient {
  const queryCalls: QueryOptions[] = [];
  const insertCalls: FakeClient["insertCalls"] = [];

  return {
    queryCalls,
    insertCalls,
    async query(options) {
      queryCalls.push(options);
      if (overrides.query) return overrides.query(options);
      return { rows: [] };
    },
    stream() {
      throw new Error("not used by replaceStore");
    },
    async insert(options) {
      insertCalls.push(options as FakeClient["insertCalls"][number]);
    },
    async close() {},
  };
}

function buildArgs(client: ClickHouseClient) {
  return {
    client,
    table: foldTable,
    tenantIdColumn: "TenantId" as const,
    keyColumn: "AggregateId" as const,
    stateColumn: "State" as const,
    deliverySeqColumn: "DeliverySeq" as const,
    stateVersionColumn: "StateVersion" as const,
    expectedVersion: EXPECTED_VERSION,
  };
}

function foundRow(args: { version?: string; deliverySeq?: string; state?: object }) {
  return {
    rows: [
      [
        args.version ?? EXPECTED_VERSION,
        args.deliverySeq ?? "3",
        JSON.stringify(args.state ?? { count: 7 }),
      ],
    ],
    header: {
      names: ["StateVersion", "DeliverySeq", "State"],
      types: ["String", "UInt64", "String"],
    },
  };
}

describe("given createReplaceStore()", () => {
  describe("when the table does not declare a replacing merge strategy", () => {
    it("throws at construction rather than at the first query", () => {
      const appendOnlyTable = defineTable({
        name: "append_only",
        merge: { kind: "append" },
        sortKey: ["TenantId", "Id"],
        partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
        tenant: ["TenantId"],
        columns: {
          TenantId: ch.string(),
          Id: ch.string(),
          AcceptedAt: ch.acceptedAt(),
        },
      });

      expect(() =>
        // The table declares none of the columns this store needs, so
        // `ColumnKeyOfType` resolves every role to `never` and this wiring
        // cannot be written in typed code at all. The cast is what lets the
        // test reach the runtime guard, which is the thing under test — a
        // declaration assembled from data rather than from a literal.
        createReplaceStore(
          {
            ...buildArgs(createFakeClient()),
            table: appendOnlyTable,
            keyColumn: "Id",
          } as unknown as ReplaceStoreArgs<FoldState, typeof appendOnlyTable.columns>,
        ),
      ).toThrow(ReplaceStoreConfigurationError);
    });
  });

  describe("when the key column is not part of the table's sort key", () => {
    it("throws at construction", () => {
      const tableWithUnkeyedColumn = defineTable({
        name: "fold_state_bad_key",
        merge: replacing({ version: "WrittenAt" }),
        sortKey: ["TenantId"],
        partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
        tenant: ["TenantId"],
        columns: {
          TenantId: ch.string(),
          AggregateId: ch.string(),
          AcceptedAt: ch.acceptedAt(),
          State: ch.json(STATE_SCHEMA),
          DeliverySeq: ch.uint64(),
          StateVersion: ch.string(),
          WrittenAt: ch.writtenAt(),
        },
      });

      expect(() =>
        createReplaceStore<FoldState, typeof tableWithUnkeyedColumn.columns>({
          ...buildArgs(createFakeClient()),
          table: tableWithUnkeyedColumn,
        }),
      ).toThrow(/sort key/);
    });
  });

  describe("when the table declares a column this store cannot manage", () => {
    it("throws at construction rather than crashing the first insert", () => {
      const tableWithUnownedColumn = defineTable({
        name: "fold_state_extra",
        merge: replacing({ version: "WrittenAt" }),
        sortKey: ["TenantId", "AggregateId"],
        partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
        tenant: ["TenantId"],
        columns: {
          TenantId: ch.string(),
          AggregateId: ch.string(),
          AcceptedAt: ch.acceptedAt(),
          State: ch.json(STATE_SCHEMA),
          DeliverySeq: ch.uint64(),
          StateVersion: ch.string(),
          WrittenAt: ch.writtenAt(),
          // Not frozen, not platform-controlled, and not one of the managed
          // roles: this store has no value to put here.
          Notes: ch.string(),
        },
      });

      expect(() =>
        createReplaceStore<FoldState, typeof tableWithUnownedColumn.columns>({
          ...buildArgs(createFakeClient()),
          table: tableWithUnownedColumn,
        }),
      ).toThrow(/Notes/);
    });
  });

  describe("when reading a key with no stored row", () => {
    it("reports absent", async () => {
      const client = createFakeClient({ query: async () => ({ rows: [] }) });
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      const result = await store.read("agg-1", { tenantId: "tenant-a" });

      expect(result).toEqual({ kind: "absent" });
    });
  });

  describe("when reading a key whose stored row matches the expected version", () => {
    it("decodes the state and reports it as found", async () => {
      const client = createFakeClient({
        query: async () => foundRow({ deliverySeq: "42", state: { count: 9 } }),
      });
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      const result = await store.read("agg-1", { tenantId: "tenant-a" });

      expect(result).toEqual({
        kind: "found",
        stored: { state: { count: 9 }, deliverySeq: 42, version: EXPECTED_VERSION },
      });
    });

    it("applies the read-your-writes setting on every read", async () => {
      const client = createFakeClient({ query: async () => ({ rows: [] }) });
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      await store.read("agg-1", { tenantId: "tenant-a" });

      expect(client.queryCalls).toHaveLength(1);
      expect(client.queryCalls[0]?.settings).toMatchObject({
        select_sequential_consistency: 1,
      });
    });

    it("builds the read as a point lookup ordered by the merge version, not a hand-written scan", async () => {
      const client = createFakeClient({ query: async () => ({ rows: [] }) });
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      await store.read("agg-1", { tenantId: "tenant-a" });

      const sql = client.queryCalls[0]?.sql ?? "";
      expect(sql).toContain("WHERE TenantId = {tenantId:String} AND AggregateId = {key:String}");
      expect(sql).toContain("ORDER BY WrittenAt DESC LIMIT 1");
      expect(client.queryCalls[0]?.params).toEqual({ tenantId: "tenant-a", key: "agg-1" });
    });
  });

  describe("when reading a key whose stored row was written under an older state version", () => {
    it("reports undecodable with the stored version, never absent", async () => {
      const client = createFakeClient({
        query: async () => foundRow({ version: "v0-legacy" }),
      });
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      const result = await store.read("agg-1", { tenantId: "tenant-a" });

      expect(result).toEqual({ kind: "undecodable", storedVersion: "v0-legacy" });
    });

    it("never decodes the state payload, so a stale shape cannot coerce into the current one", async () => {
      // A payload that the current state schema would happily accept, stored
      // under an older version. If the gate ran after the row decode, this
      // would be parsed into a plausible value on the way to being discarded —
      // and a coercing schema would parse a genuinely stale payload into a
      // wrong one. Nothing but the version cell may be touched.
      const client = createFakeClient({
        query: async () => foundRow({ version: "v0-legacy", state: { count: 1 } }),
      });
      const decodeRows = vi.fn(() => {
        throw new Error("the state column must not be decoded on a version mismatch");
      });
      const store = createReplaceStore<FoldState, typeof foldTable.columns>({
        ...buildArgs(client),
        codec: {
          readFormat: "fake",
          writeFormat: "fake",
          decodeRows: decodeRows as unknown as WireCodec["decodeRows"],
          encodeRows: (() => []) as unknown as WireCodec["encodeRows"],
        },
      });

      const result = await store.read("agg-1", { tenantId: "tenant-a" });

      expect(result).toEqual({ kind: "undecodable", storedVersion: "v0-legacy" });
      expect(decodeRows).not.toHaveBeenCalled();
    });

    it("reports undecodable with the failure as its cause when the version cell itself will not decode", async () => {
      const client = createFakeClient({
        query: async () => ({
          // A `String` column handed a JSON number: the version cannot be read
          // at all, which still must not read as absent.
          rows: [[42, "1", JSON.stringify({ count: 1 })]],
          header: {
            names: ["StateVersion", "DeliverySeq", "State"],
            types: ["String", "UInt64", "String"],
          },
        }),
      });
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      const result = await store.read("agg-1", { tenantId: "tenant-a" });

      expect(result.kind).toBe("undecodable");
      expect((result as { storedVersion?: string }).storedVersion).toBeUndefined();
      expect((result as { cause?: unknown }).cause).toBeDefined();
    });
  });

  describe("when the stored row's state column cannot be decoded despite a matching version", () => {
    it("reports undecodable with a cause instead of throwing", async () => {
      const client = createFakeClient({
        query: async () => ({
          rows: [[EXPECTED_VERSION, "1", "not valid json"]],
          header: {
            names: ["StateVersion", "DeliverySeq", "State"],
            types: ["String", "UInt64", "String"],
          },
        }),
      });
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      const result = await store.read("agg-1", { tenantId: "tenant-a" });

      expect(result.kind).toBe("undecodable");
      expect((result as { cause?: unknown }).cause).toBeDefined();
    });
  });

  describe("when writing state for a key", () => {
    it("inserts one durable, retry-safe row carrying the tenant, key, state and both versions", async () => {
      const client = createFakeClient();
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      await store.write(
        "agg-1",
        { state: { count: 5 }, deliverySeq: 7, version: EXPECTED_VERSION },
        { tenantId: "tenant-a" },
      );

      expect(client.insertCalls).toHaveLength(1);
      const call = client.insertCalls[0]!;
      expect(call.table).toBe("fold_state");
      expect(call.tenantId).toBe("tenant-a");
      expect(call.target).toEqual({ kind: "replacing" });
      expect(call.columns).toEqual([
        "TenantId",
        "AggregateId",
        "AcceptedAt",
        "State",
        "DeliverySeq",
        "StateVersion",
        "WrittenAt",
      ]);

      const [row] = call.rows;
      const byColumn = Object.fromEntries(call.columns.map((name, i) => [name, row?.[i]]));
      expect(byColumn.TenantId).toBe("tenant-a");
      expect(byColumn.AggregateId).toBe("agg-1");
      expect(byColumn.State).toBe(JSON.stringify({ count: 5 }));
      expect(byColumn.DeliverySeq).toBe("7");
      expect(byColumn.StateVersion).toBe(EXPECTED_VERSION);
    });

    it("stamps a fresh writtenAt so a later write always outranks an earlier one", async () => {
      const client = createFakeClient();
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      const before = Date.now();
      await store.write(
        "agg-1",
        { state: { count: 1 }, deliverySeq: 1, version: EXPECTED_VERSION },
        { tenantId: "tenant-a" },
      );
      const after = Date.now();

      const call = client.insertCalls[0]!;
      const writtenAtIndex = call.columns.indexOf("WrittenAt");
      const writtenAtCell = call.rows[0]?.[writtenAtIndex];
      expect(typeof writtenAtCell).toBe("string");
      const writtenAtMs = Date.parse(`${(writtenAtCell as string).replace(" ", "T")}Z`);
      expect(writtenAtMs).toBeGreaterThanOrEqual(before - 1);
      expect(writtenAtMs).toBeLessThanOrEqual(after + 1);
    });
  });

  describe("when the client's query call itself fails", () => {
    it("propagates the failure rather than swallowing it as undecodable", async () => {
      const client = createFakeClient({
        query: async () => {
          throw new Error("connection refused");
        },
      });
      const store = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(client));

      await expect(store.read("agg-1", { tenantId: "tenant-a" })).rejects.toThrow(
        "connection refused",
      );
    });
  });

  describe("when constructed twice for the same table", () => {
    it("does not share mutable state between two store instances", async () => {
      const clientA = createFakeClient();
      const clientB = createFakeClient();
      const storeA = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(clientA));
      const storeB = createReplaceStore<FoldState, typeof foldTable.columns>(buildArgs(clientB));

      await storeA.write(
        "agg-1",
        { state: { count: 1 }, deliverySeq: 1, version: EXPECTED_VERSION },
        { tenantId: "tenant-a" },
      );

      expect(clientA.insertCalls).toHaveLength(1);
      expect(clientB.insertCalls).toHaveLength(0);
    });
  });
});

describe("given a custom codec injected into createReplaceStore()", () => {
  it("routes both reads and writes through the injected codec rather than a default one", async () => {
    const client = createFakeClient({ query: async () => foundRow({}) });
    const decodeRows = vi.fn(() => [
      { StateVersion: EXPECTED_VERSION, DeliverySeq: 2n, State: { count: 1 } },
    ]);
    const encodeRows = vi.fn(() => [["encoded-by-fake-codec"]]);
    const store = createReplaceStore<FoldState, typeof foldTable.columns>({
      ...buildArgs(client),
      codec: {
        readFormat: "fake",
        writeFormat: "fake",
        // `decodeRows`/`encodeRows` are generic in the row type; a `vi.fn`
        // cannot be, so the mocks are cast into the slot and asserted on
        // directly rather than through the codec.
        decodeRows: decodeRows as unknown as WireCodec["decodeRows"],
        encodeRows: encodeRows as unknown as WireCodec["encodeRows"],
      },
    });

    await store.read("agg-1", { tenantId: "tenant-a" });
    expect(decodeRows).toHaveBeenCalledOnce();

    await store.write(
      "agg-1",
      { state: { count: 1 }, deliverySeq: 1, version: EXPECTED_VERSION },
      { tenantId: "tenant-a" },
    );
    expect(encodeRows).toHaveBeenCalledOnce();
    expect(client.insertCalls[0]?.rows).toEqual([["encoded-by-fake-codec"]]);
  });
});
