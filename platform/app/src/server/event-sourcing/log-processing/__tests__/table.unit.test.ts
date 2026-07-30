import { ch, defineTable, replacing } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import { logRecordsTable, logUsageEstimatesTable } from "../table";

describe("logRecordsTable", () => {
  it("declares the deployed ReplacingMergeTree(DedupVersion), so a redelivery is retry-safe", () => {
    expect(logRecordsTable.merge).toEqual({
      kind: "replacing",
      version: "DedupVersion",
    });
  });

  it("anchors its partition and TTL on AcceptedAt — frozen and platform-controlled", () => {
    const description = logRecordsTable.describe();
    expect(description.partition.column).toBe("AcceptedAt");
    expect(description.ttl?.anchor).toBe("AcceptedAt");
  });

  describe("given the deployed anchor, which is the customer-supplied TimeUnixMs", () => {
    it("is refused by defineTable, which is why the declaration cannot mirror the deployment", () => {
      expect(() =>
        defineTable({
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
        }),
      ).toThrow(/partition column "TimeUnixMs" is not frozen/);
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
  it("declares the deployed ReplacingMergeTree(DedupVersion), like log_records", () => {
    expect(logUsageEstimatesTable.merge).toEqual({
      kind: "replacing",
      version: "DedupVersion",
    });
  });

  it("anchors its partition and TTL on AcceptedAt, matching the deployed migration exactly", () => {
    const description = logUsageEstimatesTable.describe();
    expect(description.partition).toEqual({
      by: "toYYYYMM(AcceptedAt)",
      column: "AcceptedAt",
    });
    expect(description.ttl).toEqual({ anchor: "AcceptedAt" });
  });

  it("keeps RecordId in its sort key", () => {
    expect(logUsageEstimatesTable.sortKey).toContain("RecordId");
  });
});
