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
