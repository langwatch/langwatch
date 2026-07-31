import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ch } from "../schema/columns";
import { append, defineTable, replacing } from "../schema/defineTable";
import {
  deriveAppendMapping,
  deriveRowMapping,
  type RowContext,
  RowMappingError,
} from "./rowMapping";

const RUN_STATE = z.object({
  label: z.string(),
  /** A `UInt64` column reached through a JS number — narrowed on the way back. */
  eventCount: z.number(),
  /** The same column type reached through a bigint — never narrowed. */
  ledgerId: z.bigint(),
  drift: z.number(),
  /** Epoch milliseconds; the column is `DateTime64(3)`. */
  startedAt: z.number(),
  /** Epoch milliseconds at midnight UTC; the column is `Date`. */
  day: z.number(),
  score: z.number().nullable(),
  counters: z.record(z.string(), z.number()),
  /** Fills the frozen platform-controlled partition anchor. */
  acceptedAt: z.number(),
});

type RunState = z.infer<typeof RUN_STATE>;

const runTable = defineTable({
  name: "run_analytics",
  merge: replacing({ version: "WrittenAt" }),
  sortKey: ["TenantId", "RunId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  columns: {
    TenantId: ch.string(),
    RunId: ch.string(),
    Label: ch.string(),
    EventCount: ch.uint64(),
    LedgerId: ch.uint64(),
    Drift: ch.int64(),
    StartedAt: ch.dateTime64(3),
    Day: ch.date(),
    Score: ch.nullable(ch.float64()),
    Counters: ch.map(ch.string(), ch.float64()),
    AcceptedAt: ch.acceptedAt(),
    StateVersion: ch.string(),
    WrittenAt: ch.writtenAt(),
    _retention_days: ch.uint64(),
  },
});

const BASE_STATE: RunState = {
  label: "steady",
  eventCount: 42,
  ledgerId: 9_007_199_254_740_993n,
  drift: -7,
  startedAt: Date.UTC(2026, 5, 4, 3, 2, 1, 123),
  day: Date.UTC(2026, 5, 4),
  score: 0.75,
  counters: { retries: 2, errors: 0 },
  acceptedAt: Date.UTC(2026, 5, 4, 3, 0, 0),
};

const CONTEXT: RowContext = {
  tenantId: "tenant-a",
  key: "run-1",
  version: "v3",
  writtenAt: new Date("2026-07-01T12:00:00.000Z"),
  retentionDays: 90,
};

function stateWith(overrides: Partial<RunState>): RunState {
  return { ...BASE_STATE, ...overrides };
}

function buildMapping() {
  return deriveRowMapping<RunState, typeof runTable.columns>({
    table: runTable,
    state: RUN_STATE,
    key: "RunId",
    tenant: "TenantId",
    stateVersionColumn: "StateVersion",
  });
}

describe("given deriveRowMapping()", () => {
  describe("when a state is written to a row and read back", () => {
    it("returns every state field it started from", () => {
      const mapping = buildMapping();

      const restored = mapping.fromRow(mapping.toRow(BASE_STATE, CONTEXT));

      expect(restored).toEqual(BASE_STATE);
    });

    it("returns the state fields and nothing else, so the row's bookkeeping stays out of state", () => {
      const mapping = buildMapping();

      const restored = mapping.fromRow(mapping.toRow(BASE_STATE, CONTEXT));

      expect(Object.keys(restored).sort()).toEqual(
        Object.keys(BASE_STATE).sort(),
      );
    });
  });

  describe("when the state's own type decides the coercion", () => {
    it("widens a number onto a 64-bit integer column and narrows it back", () => {
      const mapping = buildMapping();

      const row = mapping.toRow(
        stateWith({ eventCount: 42, drift: -7 }),
        CONTEXT,
      );

      expect(row.EventCount).toEqual(42n);
      expect(row.Drift).toEqual(-7n);
      expect(mapping.fromRow(row)).toMatchObject({ eventCount: 42, drift: -7 });
    });

    it("rounds a fractional number onto a 64-bit integer column rather than refusing it", () => {
      const mapping = buildMapping();

      const row = mapping.toRow(stateWith({ eventCount: 41.6 }), CONTEXT);

      expect(row.EventCount).toEqual(42n);
    });

    it("leaves a bigint field alone on the same column type, so a value past 2^53 survives", () => {
      const mapping = buildMapping();
      const beyondDoublePrecision = 9_007_199_254_740_993n;

      const row = mapping.toRow(
        stateWith({ ledgerId: beyondDoublePrecision }),
        CONTEXT,
      );

      expect(row.LedgerId).toEqual(beyondDoublePrecision);
      expect(mapping.fromRow(row).ledgerId).toEqual(beyondDoublePrecision);
    });

    it("writes epoch milliseconds as a Date and reads them back as milliseconds", () => {
      const mapping = buildMapping();
      const startedAt = Date.UTC(2026, 5, 4, 3, 2, 1, 123);
      const day = Date.UTC(2026, 5, 4);

      const row = mapping.toRow(stateWith({ startedAt, day }), CONTEXT);

      expect(row.StartedAt).toEqual(new Date(startedAt));
      expect(row.Day).toEqual(new Date(day));
      expect(mapping.fromRow(row)).toMatchObject({ startedAt, day });
    });

    it("writes a plain object as a Map and reads it back as a plain object", () => {
      const mapping = buildMapping();
      const counters = { retries: 2, errors: 0 };

      const row = mapping.toRow(stateWith({ counters }), CONTEXT);

      expect(row.Counters).toEqual(
        new Map([
          ["retries", 2],
          ["errors", 0],
        ]),
      );
      expect(mapping.fromRow(row).counters).toEqual(counters);
    });

    it("carries a null through both directions untouched", () => {
      const mapping = buildMapping();

      const row = mapping.toRow(stateWith({ score: null }), CONTEXT);

      expect(row.Score).toBeNull();
      expect(mapping.fromRow(row).score).toBeNull();
    });
  });

  describe("when a field is absent at write time", () => {
    it("writes NULL if the column is nullable", () => {
      const optionalScore = RUN_STATE.extend({ score: z.number().optional() });
      const mapping = deriveRowMapping<
        z.infer<typeof optionalScore>,
        typeof runTable.columns
      >({
        table: runTable,
        state: optionalScore,
        key: "RunId",
        tenant: "TenantId",
        stateVersionColumn: "StateVersion",
      });

      const row = mapping.toRow({ ...BASE_STATE, score: undefined }, CONTEXT);

      expect(row.Score).toBeNull();
    });

    it("refuses the write if the column is not nullable, naming the field", () => {
      const optionalLabel = RUN_STATE.extend({ label: z.string().optional() });
      const mapping = deriveRowMapping<
        z.infer<typeof optionalLabel>,
        typeof runTable.columns
      >({
        table: runTable,
        state: optionalLabel,
        key: "RunId",
        tenant: "TenantId",
        stateVersionColumn: "StateVersion",
      });

      expect(() =>
        mapping.toRow({ ...BASE_STATE, label: undefined }, CONTEXT),
      ).toThrow(RowMappingError);
      expect(() =>
        mapping.toRow({ ...BASE_STATE, label: undefined }, CONTEXT),
      ).toThrow(/label/);
    });
  });

  describe("when the store owns a column", () => {
    it("fills the tenant, the key and the state version from the context", () => {
      const mapping = buildMapping();

      const row = mapping.toRow(BASE_STATE, CONTEXT);

      expect(row.TenantId).toBe(CONTEXT.tenantId);
      expect(row.RunId).toBe(CONTEXT.key);
      expect(row.StateVersion).toBe(CONTEXT.version);
    });

    it("stamps the merge version with the write time", () => {
      const mapping = buildMapping();

      const row = mapping.toRow(BASE_STATE, CONTEXT);

      expect(row.WrittenAt).toEqual(CONTEXT.writtenAt);
    });

    it("fills the retention column from the context and never reads it back as state", () => {
      const mapping = buildMapping();

      const row = mapping.toRow(BASE_STATE, CONTEXT);

      expect(row._retention_days).toEqual(CONTEXT.retentionDays);
      expect(mapping.fromRow(row)).not.toHaveProperty("retentionDays");
      expect(mapping.fromRow(row)).not.toHaveProperty("_retention_days");
    });

    it("yields the column to a state field of the same name, so a state carrying its own key keeps it", () => {
      const keyInState = RUN_STATE.extend({ runId: z.string() });
      const mapping = deriveRowMapping<
        z.infer<typeof keyInState>,
        typeof runTable.columns
      >({
        table: runTable,
        state: keyInState,
        key: "RunId",
        tenant: "TenantId",
        stateVersionColumn: "StateVersion",
      });

      const row = mapping.toRow(
        { ...BASE_STATE, runId: "from-state" },
        CONTEXT,
      );

      expect(row.RunId).toBe("from-state");
      expect(mapping.fromRow(row).runId).toBe("from-state");
    });
  });

  describe("when a fill is given for a column no state field supplies", () => {
    const notesTable = defineTable({
      name: "run_analytics_with_notes",
      merge: replacing({ version: "WrittenAt" }),
      sortKey: ["TenantId", "RunId"],
      partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
      tenant: ["TenantId"],
      columns: {
        TenantId: ch.string(),
        RunId: ch.string(),
        Label: ch.string(),
        AcceptedAt: ch.acceptedAt(),
        StateVersion: ch.string(),
        WrittenAt: ch.writtenAt(),
        Notes: ch.string(),
      },
    });

    const NOTES_STATE = z.object({ label: z.string(), acceptedAt: z.number() });
    const notesState = { label: "steady", acceptedAt: BASE_STATE.acceptedAt };

    it("refuses at construction without one, naming the column it cannot fill", () => {
      expect(() =>
        deriveRowMapping<
          z.infer<typeof NOTES_STATE>,
          typeof notesTable.columns
        >({
          table: notesTable,
          state: NOTES_STATE,
          key: "RunId",
          tenant: "TenantId",
          stateVersionColumn: "StateVersion",
        }),
      ).toThrow(/Notes/);
    });

    it("produces the column's value from state once the fill is given", () => {
      const mapping = deriveRowMapping<
        z.infer<typeof NOTES_STATE>,
        typeof notesTable.columns
      >({
        table: notesTable,
        state: NOTES_STATE,
        key: "RunId",
        tenant: "TenantId",
        stateVersionColumn: "StateVersion",
        fill: { Notes: (state) => `about ${state.label}` },
      });

      expect(mapping.toRow(notesState, CONTEXT).Notes).toBe("about steady");
    });

    it("does not read a filled column back as state, the fill being its only source", () => {
      const mapping = deriveRowMapping<
        z.infer<typeof NOTES_STATE>,
        typeof notesTable.columns
      >({
        table: notesTable,
        state: NOTES_STATE,
        key: "RunId",
        tenant: "TenantId",
        stateVersionColumn: "StateVersion",
        fill: { Notes: () => "unset" },
      });

      expect(
        mapping.fromRow(mapping.toRow(notesState, CONTEXT)),
      ).not.toHaveProperty("notes");
    });
  });

  describe("when a state field has no column of its own", () => {
    it("refuses at construction, naming the field and the column it looked for", () => {
      const withStray = RUN_STATE.extend({ strayField: z.string() });

      expect(() =>
        deriveRowMapping<z.infer<typeof withStray>, typeof runTable.columns>({
          table: runTable,
          state: withStray,
          key: "RunId",
          tenant: "TenantId",
          stateVersionColumn: "StateVersion",
        }),
      ).toThrow(/strayField.*StrayField/);
    });
  });

  describe("when the state schema is not an object", () => {
    it("refuses at construction, having no field list to map from", () => {
      expect(() =>
        deriveRowMapping<string, typeof runTable.columns>({
          table: runTable,
          state: z.string(),
          key: "RunId",
          tenant: "TenantId",
          stateVersionColumn: "StateVersion",
        }),
      ).toThrow(RowMappingError);
    });
  });
});

describe("given deriveAppendMapping()", () => {
  const eventsTable = defineTable({
    name: "billable_events",
    merge: append(),
    sortKey: ["TenantId", "EventId"],
    partition: { by: "toYYYYMM(AcceptedAt)", column: "AcceptedAt" },
    tenant: ["TenantId"],
    columns: {
      TenantId: ch.string(),
      EventId: ch.string(),
      SizeBytes: ch.uint32(),
      AcceptedAt: ch.acceptedAt(),
      WrittenAt: ch.writtenAt(),
    },
  });

  const record = z.object({
    tenantId: z.string(),
    eventId: z.string(),
    sizeBytes: z.number(),
  });

  const batch = { tenantId: "tenant-a" };

  describe("when every column has a record field or a fill", () => {
    it("maps each field onto the column named after it", () => {
      const toRow = deriveAppendMapping({
        table: eventsTable,
        record,
        fill: {
          AcceptedAt: () => new Date(1_000),
          WrittenAt: () => new Date(2_000),
        },
      });

      expect(
        toRow({ tenantId: "tenant-a", eventId: "e1", sizeBytes: 12 }, batch),
      ).toEqual({
        TenantId: "tenant-a",
        EventId: "e1",
        SizeBytes: 12,
        AcceptedAt: new Date(1_000),
        WrittenAt: new Date(2_000),
      });
    });

    it("hands the batch context to a fill, so a row can carry what the delivery knew", () => {
      const toRow = deriveAppendMapping({
        table: eventsTable,
        record: z.object({ eventId: z.string(), sizeBytes: z.number() }),
        fill: {
          TenantId: (_record, context) => context.tenantId,
          AcceptedAt: () => new Date(0),
          WrittenAt: () => new Date(0),
        },
      });

      expect(toRow({ eventId: "e1", sizeBytes: 1 }, batch).TenantId).toBe(
        "tenant-a",
      );
    });
  });

  describe("when a column has neither a record field nor a fill", () => {
    it("refuses at construction rather than on the first write", () => {
      expect(() =>
        deriveAppendMapping({
          table: eventsTable,
          record: z.object({ tenantId: z.string() }),
          fill: {},
        }),
      ).toThrow(RowMappingError);
    });
  });
});

describe("given a fill for a frozen, platform-controlled column", () => {
  const anchoredTable = defineTable({
    name: "anchored_fold",
    merge: replacing({ version: "UpdatedAt" }),
    sortKey: ["TenantId", "RunId"],
    partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
    tenant: ["TenantId"],
    ttl: { anchor: "AcceptedAt" },
    columns: {
      TenantId: ch.string(),
      RunId: ch.string(),
      AcceptedAt: ch.acceptedAt(),
      Completed: ch.uint32(),
      Version: ch.string(),
      UpdatedAt: ch.writtenAt(),
    },
  });

  /** @scenario a partition anchor is not re-stamped on every write */
  it("refuses at construction, because re-stamping it would migrate the row's partition", () => {
    expect(() =>
      deriveRowMapping({
        table: anchoredTable,
        state: z.object({ completed: z.number() }),
        key: "RunId",
        tenant: "TenantId",
        stateVersionColumn: "Version",
        fill: { AcceptedAt: () => new Date() },
      }),
    ).toThrow(RowMappingError);
  });

  it("accepts the same column when the state carries it, so the fold can freeze it", () => {
    const mapping = deriveRowMapping({
      table: anchoredTable,
      state: z.object({ acceptedAt: z.number(), completed: z.number() }),
      key: "RunId",
      tenant: "TenantId",
      stateVersionColumn: "Version",
    });

    const row = mapping.toRow(
      { acceptedAt: 1_000, completed: 2 },
      {
        tenantId: "tenant-a",
        key: "run-1",
        version: "v1",
        writtenAt: new Date(9_000),
        retentionDays: 30,
      },
    );

    expect(row.AcceptedAt).toEqual(new Date(1_000));
  });
});
