import { describe, expect, it } from "vitest";
import type { TableDescription } from "./defineTable.js";
import {
  assertNoDrift,
  type DeployedTableInfo,
  findTableDrift,
  TableDriftError,
} from "./tableDrift.js";

/**
 * `findTableDrift`/`assertNoDrift` are the comparison ADR-099's drift test
 * runs against a live ClickHouse; these tests exercise that comparison
 * directly, with a fake `DeployedTableInfo`, so every kind of disagreement
 * is proven caught without a database.
 */

const description: TableDescription = {
  name: "widgets",
  merge: { kind: "replacing", version: "WrittenAt" },
  sortKey: ["TenantId", "Key"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columnNames: ["TenantId", "Key", "Value", "WrittenAt", "AcceptedAt"],
  columnTypes: {
    TenantId: "String",
    Key: "String",
    Value: "String",
    WrittenAt: "DateTime64(3)",
    AcceptedAt: "DateTime64(3)",
  },
};

const matchingDeployed: DeployedTableInfo = {
  engineFull: "ReplacingMergeTree(WrittenAt)",
  sortingKey: "TenantId, Key",
  partitionKey: "toYearWeek(AcceptedAt)",
  createTableQuery:
    "CREATE TABLE widgets (...) ENGINE = ReplacingMergeTree(WrittenAt) " +
    "PARTITION BY toYearWeek(AcceptedAt) ORDER BY (TenantId, Key) " +
    "TTL AcceptedAt + INTERVAL 30 DAY",
  columns: [
    { name: "TenantId", type: "String" },
    { name: "Key", type: "String" },
    { name: "Value", type: "String" },
    { name: "WrittenAt", type: "DateTime64(3)" },
    { name: "AcceptedAt", type: "DateTime64(3)" },
  ],
};

describe("given a declaration and a deployed table that agree on every dimension", () => {
  /** @scenario a declaration whose engine, sort key, partition and columns all match produces no drift */
  it("reports no drift", () => {
    expect(findTableDrift(description, matchingDeployed)).toEqual([]);
    expect(() => assertNoDrift(description, matchingDeployed)).not.toThrow();
  });
});

describe("given a deployed engine whose version column disagrees", () => {
  /** @scenario a mismatched ReplacingMergeTree version is reported naming both values */
  it("reports the table, the declared version and the deployed engine", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      engineFull: "ReplacingMergeTree(SomeOtherColumn)",
    };

    expect(findTableDrift(description, deployed)).toEqual([
      'table "widgets": declared replacing(version="WrittenAt") but the deployed engine is "ReplacingMergeTree(SomeOtherColumn)"',
    ]);
  });
});

describe("given a deployed sort key that disagrees", () => {
  /** @scenario a mismatched sort key is reported naming both */
  it("reports the table and both sort keys", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      sortingKey: "TenantId, Value",
    };

    expect(findTableDrift(description, deployed)).toEqual([
      'table "widgets": declared sort key (TenantId, Key) but the deployed sort key is (TenantId, Value)',
    ]);
  });
});

describe("given a deployed partition expression that disagrees", () => {
  /** @scenario a mismatched partition expression is reported naming both */
  it("reports the table and both expressions", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      partitionKey: "toYYYYMM(AcceptedAt)",
    };

    expect(findTableDrift(description, deployed)).toEqual([
      'table "widgets": declared partition "toYearWeek(AcceptedAt)" but the deployed partition is "toYYYYMM(AcceptedAt)"',
    ]);
  });
});

describe("given a declared TTL anchor missing from the deployed DDL", () => {
  /** @scenario a declared TTL anchor missing from the deployed DDL is reported */
  it("reports the table and the missing anchor", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      createTableQuery: matchingDeployed.createTableQuery.replace(
        "TTL AcceptedAt + INTERVAL 30 DAY",
        "",
      ),
    };

    expect(findTableDrift(description, deployed)).toEqual([
      'table "widgets": declared TTL anchor "AcceptedAt" but the deployed DDL has no "TTL AcceptedAt" clause',
    ]);
  });
});

describe("given a declared column absent from the deployed table", () => {
  /** @scenario a declared column absent from the deployed table is reported */
  it("reports the table and the missing column", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      columns: matchingDeployed.columns.filter(
        (column) => column.name !== "Value",
      ),
    };

    expect(findTableDrift(description, deployed)).toEqual([
      'table "widgets": column "Value" is declared but not present in the deployed table',
    ]);
  });
});

describe("given a declared column whose type disagrees with the deployed type", () => {
  /** @scenario a declared column whose type disagrees with the deployed type is reported naming both */
  it("reports the table, the column and both types", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      columns: matchingDeployed.columns.map((column) =>
        column.name === "Value" ? { name: "Value", type: "UInt64" } : column,
      ),
    };

    expect(findTableDrift(description, deployed)).toEqual([
      'table "widgets": column "Value" is declared as "String" but the deployed type is "UInt64"',
    ]);
  });
});

describe("given two declared columns whose relative order disagrees with the deployed table", () => {
  /** @scenario two declared columns whose relative order disagrees with the deployed table is reported */
  it("reports the later-declared column as out of order", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      columns: [
        { name: "TenantId", type: "String" },
        { name: "Value", type: "String" },
        { name: "Key", type: "String" },
        { name: "WrittenAt", type: "DateTime64(3)" },
        { name: "AcceptedAt", type: "DateTime64(3)" },
      ],
    };

    expect(findTableDrift(description, deployed)).toEqual([
      'table "widgets": column "Value" is declared out of order — it comes earlier in the declaration than in the deployed table',
    ]);
  });
});

describe("given a deployed table with undeclared trailing columns", () => {
  /** @scenario a deployed table with undeclared trailing columns is not reported as drift */
  it("reports no drift — a declaration need not enumerate every physical column", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      columns: [
        ...matchingDeployed.columns,
        { name: "_retention_days", type: "UInt16" },
        { name: "_size_bytes", type: "UInt32" },
      ],
    };

    expect(findTableDrift(description, deployed)).toEqual([]);
  });
});

describe("given several disagreements at once", () => {
  /** @scenario every disagreement is reported, not just the first */
  it("reports every issue found", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      sortingKey: "TenantId, Value",
      partitionKey: "toYYYYMM(AcceptedAt)",
    };

    const issues = findTableDrift(description, deployed);

    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/sort key/);
    expect(issues[1]).toMatch(/partition/);
  });

  it("assertNoDrift throws a TableDriftError carrying every issue", () => {
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      sortingKey: "TenantId, Value",
      partitionKey: "toYYYYMM(AcceptedAt)",
    };

    expect(() => assertNoDrift(description, deployed)).toThrow(TableDriftError);
    try {
      assertNoDrift(description, deployed);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TableDriftError);
      const drift = error as TableDriftError;
      expect(drift.issues).toHaveLength(2);
      expect(drift.message).toContain("sort key");
      expect(drift.message).toContain("partition");
    }
  });
});

describe("given an append() declaration against a deployed aggregating engine", () => {
  /** @scenario an append table declared against a deployed aggregating engine is reported */
  it("reports the table and the deployed engine", () => {
    const appendDescription: TableDescription = {
      ...description,
      merge: { kind: "append" },
    };
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      engineFull: "AggregatingMergeTree",
    };

    expect(findTableDrift(appendDescription, deployed)).toEqual([
      'table "widgets": declared append() but the deployed engine is "AggregatingMergeTree"',
    ]);
  });
});

describe("given an aggregating() declaration against a deployed append engine", () => {
  /** @scenario an aggregating table declared against a deployed append engine is reported */
  it("reports the table and the deployed engine", () => {
    const aggregatingDescription: TableDescription = {
      ...description,
      merge: { kind: "aggregating", idempotency: "upstream-exactly-once" },
    };
    const deployed: DeployedTableInfo = {
      ...matchingDeployed,
      engineFull: "MergeTree",
    };

    expect(findTableDrift(aggregatingDescription, deployed)).toEqual([
      'table "widgets": declared aggregating() but the deployed engine is "MergeTree"',
    ]);
  });
});
