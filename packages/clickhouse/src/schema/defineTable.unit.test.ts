import { describe, expect, it } from "vitest";
import { ch, type ColumnMap } from "./columns.js";
import {
  aggregating,
  append,
  defineTable,
  replacing,
  TableDefinitionError,
} from "./defineTable.js";

/**
 * The declaration's whole point is that a bad table fails to build rather
 * than failing at read time, so these tests are mostly about the guards:
 * each one is a rule from ADR-099 that the schema-catalogue this replaces
 * declared but never checked.
 */

// The `columns` map is widened to `ColumnMap` deliberately: it lets the
// negative tests below reference a column name that was never declared, which
// is exactly the runtime case `defineTable` guards (a caller assembling a
// declaration from data, not a fixed literal).
const validColumns: ColumnMap = {
  TenantId: ch.string(),
  OccurredAt: ch.occurredAt(),
  AcceptedAt: ch.acceptedAt(),
  UpdatedAt: ch.writtenAt(),
  TraceId: ch.string(),
  TotalCost: ch.float64(),
};

const validTableArgs = () => ({
  name: "trace_analytics",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "AcceptedAt", "TraceId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: validColumns,
});

describe("given a valid table declaration", () => {
  it("builds a table definition exposing the declared facts", () => {
    const table = defineTable(validTableArgs());

    expect(table.name).toBe("trace_analytics");
    expect(table.merge).toEqual({ kind: "replacing", version: "UpdatedAt" });
    expect(table.sortKey).toEqual(["TenantId", "AcceptedAt", "TraceId"]);
  });

  it("preserves declaration order in columnNames, not alphabetical order", () => {
    const table = defineTable(validTableArgs());

    expect(table.columnNames).toEqual([
      "TenantId",
      "OccurredAt",
      "AcceptedAt",
      "UpdatedAt",
      "TraceId",
      "TotalCost",
    ]);
  });

  it("decodes a raw row through rowSchema using each column's schema", () => {
    const table = defineTable(validTableArgs());

    const row = table.rowSchema.parse({
      TenantId: "tenant-1",
      OccurredAt: "2026-07-29 00:00:00.000",
      AcceptedAt: "2026-07-29 00:00:01.000",
      UpdatedAt: "2026-07-29 00:00:02.000",
      TraceId: "trace-1",
      TotalCost: 1.5,
    }) as Record<string, unknown>;

    expect(row.TenantId).toBe("tenant-1");
    expect(row.TotalCost).toBe(1.5);
    expect(row.AcceptedAt).toBeInstanceOf(Date);
  });

  it("describes the facts a drift test can compare against migration DDL", () => {
    const table = defineTable(validTableArgs());

    expect(table.describe()).toEqual({
      name: "trace_analytics",
      merge: { kind: "replacing", version: "UpdatedAt" },
      sortKey: ["TenantId", "AcceptedAt", "TraceId"],
      partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
      tenant: ["TenantId"],
      ttl: { anchor: "AcceptedAt" },
      columnNames: [
        "TenantId",
        "OccurredAt",
        "AcceptedAt",
        "UpdatedAt",
        "TraceId",
        "TotalCost",
      ],
      columnTypes: {
        TenantId: "String",
        OccurredAt: expect.any(String),
        AcceptedAt: expect.any(String),
        UpdatedAt: expect.any(String),
        TraceId: "String",
        TotalCost: "Float64",
      },
    });
  });

  it("builds an append table with no version column at all", () => {
    const table = defineTable({
      name: "stored_spans",
      merge: append(),
      sortKey: ["TenantId", "SpanId"],
      partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
      tenant: ["TenantId"],
      columns: {
        TenantId: ch.string(),
        SpanId: ch.string(),
        AcceptedAt: ch.acceptedAt(),
      },
    });

    expect(table.merge).toEqual({ kind: "append" });
  });

  it("builds an aggregating table that declares its idempotency story", () => {
    const table = defineTable({
      name: "gateway_budget_scope_totals",
      merge: aggregating({ idempotency: "upstream-exactly-once" }),
      sortKey: ["TenantId", "ScopeId"],
      partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
      tenant: ["TenantId"],
      columns: {
        TenantId: ch.string(),
        ScopeId: ch.string(),
        AcceptedAt: ch.acceptedAt(),
        TotalCost: ch.float64(),
      },
    });

    expect(table.merge).toEqual({
      kind: "aggregating",
      idempotency: "upstream-exactly-once",
    });
  });
});

describe("given a partition column that is not frozen and platform-controlled", () => {
  it("rejects partitioning on occurredAt and names the rule", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
      }),
    ).toThrow(TableDefinitionError);

    expect(() =>
      defineTable({
        ...validTableArgs(),
        partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
      }),
    ).toThrow(/partition column "OccurredAt" is not frozen and platform-controlled/);
  });
});

describe("given a TTL anchored on a column that is not frozen and platform-controlled", () => {
  it("rejects a TTL anchored on occurredAt", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        ttl: { anchor: "OccurredAt" },
      }),
    ).toThrow(/TTL anchor "OccurredAt" is not frozen and platform-controlled/);
  });
});

describe("given a replacing table whose version does not order writes", () => {
  it("rejects a version column that is not a writtenAt column", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        merge: replacing({ version: "OccurredAt" }),
      }),
    ).toThrow(/version column "OccurredAt" is not a writtenAt column/);
  });

  it("rejects a version column that was never declared", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        merge: replacing({ version: "MissingColumn" }),
      }),
    ).toThrow(/replacing version names undeclared column "MissingColumn"/);
  });
});

describe("given a sort key naming an undeclared column", () => {
  it("rejects the unknown column", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        sortKey: ["TenantId", "MissingColumn"],
      }),
    ).toThrow(/sort key names undeclared column "MissingColumn"/);
  });
});

describe("given an empty sort key", () => {
  it("rejects a table with no ordering column", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        sortKey: [],
      }),
    ).toThrow(/declares an empty sort key/);
  });
});

describe("given an empty tenant list", () => {
  it("rejects a table with no tenant scope", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        tenant: [],
      }),
    ).toThrow(/declares no tenant columns/);
  });
});

/**
 * `structuralDebt` is the exemption ADR-099's guard needs for the three
 * deployed tables whose structural column genuinely fails the rule and
 * cannot be re-keyed without a migration. It never weakens the guard for a
 * table, or a column, that does not name itself here.
 */
describe("given a table that names known structural debt for its partition column", () => {
  /** @scenario a partition column exempted as structural debt compiles and keeps its true role */
  it("builds successfully and the column still reports its true, non-structural role", () => {
    const table = defineTable({
      ...validTableArgs(),
      partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
      structuralDebt: [
        {
          column: "OccurredAt",
          reason: "customer-supplied event time anchors the partition; re-key pending",
        },
      ],
    });

    expect(table.columns.OccurredAt!.timeRole).toBe("occurredAt");
    expect(table.columns.OccurredAt!.frozen).toBe(false);
    expect(table.columns.OccurredAt!.platformControlled).toBe(false);
  });
});

describe("given a table that names known structural debt for its replacing version", () => {
  /** @scenario a replacing version exempted as structural debt compiles and keeps its true role */
  it("builds successfully and the column still reports its true, non-writtenAt role", () => {
    const table = defineTable({
      ...validTableArgs(),
      merge: replacing({ version: "OccurredAt" }),
      structuralDebt: [
        {
          column: "OccurredAt",
          reason:
            "version carries business time, not our write clock, but still orders two versions of this row correctly",
        },
      ],
    });

    expect(table.merge).toEqual({ kind: "replacing", version: "OccurredAt" });
    expect(table.columns.OccurredAt!.timeRole).toBe("occurredAt");
  });
});

describe("given a customer-supplied partition column and no structuralDebt", () => {
  /** @scenario a table that does not opt in is still refused for a customer-supplied partition column */
  it("is refused, exactly as before the exemption mechanism existed", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
      }),
    ).toThrow(TableDefinitionError);
  });
});

describe("given a replacing version that is not writtenAt and no structuralDebt", () => {
  /** @scenario a table that does not opt in is still refused for a version column that is not writtenAt */
  it("is refused, exactly as before the exemption mechanism existed", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        merge: replacing({ version: "OccurredAt" }),
      }),
    ).toThrow(TableDefinitionError);
  });
});

describe("given a structuralDebt entry with a blank reason", () => {
  /** @scenario an exemption with no reason is refused */
  it("is refused", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
        structuralDebt: [{ column: "OccurredAt", reason: "   " }],
      }),
    ).toThrow(/needs a reason/);
  });
});

describe("given a structuralDebt entry naming a column the table never declared", () => {
  /** @scenario an exemption naming a column the table never declared is refused */
  it("is refused", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        structuralDebt: [{ column: "MissingColumn", reason: "does not exist" }],
      }),
    ).toThrow(/structural debt names undeclared column "MissingColumn"/);
  });
});

describe("given a structuralDebt entry for a column that anchors nothing", () => {
  /** @scenario an exemption for a column that anchors nothing is refused */
  it("is refused as an unused exemption", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        structuralDebt: [{ column: "TraceId", reason: "not actually structural" }],
      }),
    ).toThrow(/is not this table's partition column, TTL anchor or replacing version/);
  });
});

describe("given a structuralDebt entry that exempts a different column than the one violating the rule", () => {
  /** @scenario one column's exemption does not excuse a different column's structural violation */
  it("still refuses the table for its actual violating partition column", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
        structuralDebt: [
          {
            column: "UpdatedAt",
            reason: "placeholder — UpdatedAt already passes on its own, so this excuses nothing",
          },
        ],
      }),
    ).toThrow(/partition column "OccurredAt" is not frozen and platform-controlled/);
  });
});

describe("given the same column named twice in structuralDebt", () => {
  it("is refused", () => {
    expect(() =>
      defineTable({
        ...validTableArgs(),
        partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
        structuralDebt: [
          { column: "OccurredAt", reason: "first" },
          { column: "OccurredAt", reason: "second" },
        ],
      }),
    ).toThrow(/structural debt on column "OccurredAt" is declared twice/);
  });
});
