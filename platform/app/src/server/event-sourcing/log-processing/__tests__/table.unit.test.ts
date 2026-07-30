import { describe, expect, it } from "vitest";
import { logRecordsTable, logUsageEstimatesTable } from "../table";

describe("logRecordsTable", () => {
  it("declares an append store, since RecordId already gives its sort key per-record identity", () => {
    expect(logRecordsTable.merge).toEqual({ kind: "append" });
  });

  it("anchors its partition and TTL on AcceptedAt — frozen and platform-controlled", () => {
    const description = logRecordsTable.describe();
    expect(description.partition.column).toBe("AcceptedAt");
    expect(description.ttl?.anchor).toBe("AcceptedAt");
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
});

describe("logUsageEstimatesTable", () => {
  it("declares an append store for the same reason as log_records", () => {
    expect(logUsageEstimatesTable.merge).toEqual({ kind: "append" });
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
