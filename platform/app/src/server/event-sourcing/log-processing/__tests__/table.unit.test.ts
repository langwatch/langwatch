import { ch, defineTable, replacing } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import { logRecordsTable, logUsageEstimatesTable } from "../table";

/** Migration parity — engine, keys, anchors, column types — is asserted against
 *  the migration SQL in `../../__tests__/tableMigrationParity.unit.test.ts`. */
describe("logRecordsTable", () => {
  describe("given the deployed anchor, which is the customer-supplied TimeUnixMs", () => {
    it("is refused unless the declaration names the debt, which is why this one does", () => {
      const asDeployed = {
        name: "log_records_as_deployed",
        merge: replacing({ version: "WrittenAt" }),
        sortKey: ["TenantId", "TimeUnixMs"],
        partition: { by: "toYearWeek(TimeUnixMs)", column: "TimeUnixMs" },
        tenant: ["TenantId"],
        ttl: { anchor: "TimeUnixMs" },
        columns: {
          TenantId: ch.string(),
          TimeUnixMs: ch.occurredAt(),
          WrittenAt: ch.writtenAt(),
        },
      } as const;

      expect(() => defineTable(asDeployed)).toThrow(
        /partition column "TimeUnixMs" is not frozen/,
      );
      expect(
        defineTable({
          ...asDeployed,
          structuralDebt: [{ column: "TimeUnixMs", reason: "migration 00050" }],
        }).partition.column,
      ).toBe("TimeUnixMs");
      expect(
        logRecordsTable.structuralDebt?.map((debt) => debt.column),
      ).toContain("TimeUnixMs");
    });
  });

  it("keeps RecordId in its sort key, so a redelivered record's row collapses at merge", () => {
    expect(logRecordsTable.sortKey).toContain("RecordId");
  });

  it("is tenant-scoped", () => {
    expect(logRecordsTable.tenant).toEqual(["TenantId"]);
  });

  describe("given the small-integer columns real DDL uses (UInt8/UInt16/UInt32)", () => {
    it("decodes a bare JSON number for each, and rejects an out-of-range value", () => {
      const severity = logRecordsTable.columns.SeverityNumber;
      expect(severity.chType).toBe("UInt8");
      expect(severity.decode(17)).toBe(17);
      expect(() => severity.decode(256)).toThrow();
      expect(() => severity.decode(-1)).toThrow();

      const flags = logRecordsTable.columns.Flags;
      expect(flags.chType).toBe("UInt32");
      expect(flags.decode(4294967295)).toBe(4294967295);
    });

    it("rejects a fractional cell rather than truncating it", () => {
      expect(() => logRecordsTable.columns.Flags.decode(1.5)).toThrow();
    });
  });

  it("round-trips the 64-bit columns through bigint, never a JS number", () => {
    const encoded =
      logRecordsTable.columns.TimeUnixNano.encode(1_700_000_000_123_456_789n);
    expect(encoded).toBe("1700000000123456789");
    expect(
      logRecordsTable.columns.TimeUnixNano.decode("1700000000123456789"),
    ).toBe(1_700_000_000_123_456_789n);
  });

  it("gives DedupVersion the writtenAt role, which is what lets it be the merge version", () => {
    expect(logRecordsTable.columns.DedupVersion.chType).toBe("UInt64");
    expect(logRecordsTable.columns.DedupVersion.timeRole).toBe("writtenAt");
  });
});

describe("logUsageEstimatesTable", () => {
  it("needs no structural debt, being the one log table anchored on our own stamp", () => {
    expect(logUsageEstimatesTable.structuralDebt).toBeUndefined();
    expect(
      logUsageEstimatesTable.columns[logUsageEstimatesTable.partition.column]
        ?.timeRole,
    ).toBe("acceptedAt");
  });

  it("keeps RecordId in its sort key", () => {
    expect(logUsageEstimatesTable.sortKey).toContain("RecordId");
  });
});
