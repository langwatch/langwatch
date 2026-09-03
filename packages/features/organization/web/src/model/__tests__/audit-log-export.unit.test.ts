/**
 * What a downloaded audit report says.
 *
 * The half of the export that is decided in this package. The other half — how
 * the bytes reach the reader's disk — is the application's, and is pinned in
 * `apps/ui/tests/ui-file-download.unit.test.ts`. Splitting them is what makes
 * either assertable: the platform page minted an object URL and clicked a
 * synthesised anchor inside the same function that built the rows.
 *
 * Spec: specs/audit-log/audit-log.feature
 */

import { describe, expect, it } from "vitest";
import type { EnrichedAuditLog } from "@langwatch/organization-contract";
import {
  auditLogCsvRow,
  auditLogCsvTable,
  auditLogExportOffsets,
  auditLogFileName,
  AUDIT_LOG_CSV_FIELDS,
  CSV_JSON_CAP,
  truncateJsonForCsv,
} from "../audit-log-export";

function row(overrides: Partial<EnrichedAuditLog> = {}): EnrichedAuditLog {
  return {
    id: "audit-1",
    createdAt: new Date("2026-03-04T09:30:00.000Z"),
    userId: "user-1",
    organizationId: "org-1",
    projectId: "proj-1",
    action: "gateway.virtual_key.created",
    payload: null,
    ipAddress: "203.0.113.9",
    userAgent: "Mozilla/5.0",
    error: null,
    args: null,
    user: { id: "user-1", name: "Alice", email: "alice@example.com" },
    project: { id: "proj-1", name: "Web App" },
    source: "gateway",
    targetKind: "virtual_key",
    targetId: "vk_abcdefghijklmnopqrstuvwxyz",
    before: null,
    after: { rateLimit: "500/m" },
    ...overrides,
  };
}

describe("given a JSON column bound for a CSV cell", () => {
  describe("when the value is absent", () => {
    /** @scenario An exported report caps its JSON columns and says when it did */
    it("writes an empty cell rather than the string null", () => {
      expect(truncateJsonForCsv(null)).toBe("");
      expect(truncateJsonForCsv(void 0)).toBe("");
    });
  });

  describe("when the value fits under the cap", () => {
    /** @scenario An exported report caps its JSON columns and says when it did */
    it("writes it whole", () => {
      expect(truncateJsonForCsv({ limitUsd: 500 })).toBe('{"limitUsd":500}');
    });
  });

  describe("when the value is longer than the cap", () => {
    /** @scenario An exported report caps its JSON columns and says when it did */
    it("clips it and marks the cell as clipped", () => {
      const long = truncateJsonForCsv({ blob: "x".repeat(CSV_JSON_CAP * 2) });

      expect(long.length).toBeGreaterThan(CSV_JSON_CAP);
      expect(long.startsWith('{"blob":"xxxx')).toBe(true);
      expect(long).toMatch(/…\[truncated \d+ chars\]$/);
    });

    /**
     * A clipped cell and an empty one look identical without the marker, and a
     * reviewer reading a blank `after` column would conclude the change set
     * nothing.
     */
    /** @scenario An exported report caps its JSON columns and says when it did */
    it("says how many characters it dropped", () => {
      const value = { blob: "x".repeat(CSV_JSON_CAP) };
      const rendered = JSON.stringify(value);

      expect(truncateJsonForCsv(value)).toContain(
        `[truncated ${rendered.length - CSV_JSON_CAP} chars]`,
      );
    });
  });
});

describe("given one audit row bound for a report", () => {
  describe("when it is rendered", () => {
    /** @scenario An exported report carries the same columns the table shows */
    it("carries every column the table shows, in the header's order", () => {
      const rendered = auditLogCsvRow(row());

      expect(rendered).toHaveLength(AUDIT_LOG_CSV_FIELDS.length);
      expect(rendered[0]).toBe("2026-03-04T09:30:00.000Z");
      expect(rendered[1]).toBe("gateway");
      expect(rendered[2]).toBe("Alice");
      expect(rendered[3]).toBe("alice@example.com");
      expect(rendered[4]).toBe("gateway.virtual_key.created");
      expect(rendered[5]).toBe("virtual_key");
      expect(rendered[7]).toBe("Web App");
      expect(rendered[13]).toBe('{"rateLimit":"500/m"}');
    });
  });

  describe("when the row was written by a system actor", () => {
    /** @scenario An exported report names a system-written row without inventing an actor */
    it("leaves the actor columns empty rather than inventing a name", () => {
      const rendered = auditLogCsvRow(row({ userId: null, user: null }));

      expect(rendered[2]).toBe("");
      expect(rendered[3]).toBe("");
    });
  });

  describe("when the project row could not be resolved", () => {
    /** @scenario An exported report names a system-written row without inventing an actor */
    it("falls back to the project id so the column is never blank for a scoped row", () => {
      expect(auditLogCsvRow(row({ project: null }))[7]).toBe("proj-1");
    });
  });
});

describe("given a report and the day it was taken", () => {
  describe("when the file is named", () => {
    /** @scenario An exported report carries the same columns the table shows */
    it("dates it so two exports never collide", () => {
      expect(auditLogFileName(new Date("2026-03-04T23:59:00.000Z"))).toBe(
        "audit_logs_2026-03-04.csv",
      );
    });
  });

  describe("when the table is assembled", () => {
    /** @scenario An exported report carries the same columns the table shows */
    it("pairs the header with one row per entry", () => {
      const table = auditLogCsvTable([row(), row({ id: "audit-2" })]);

      expect(table.fields).toEqual([...AUDIT_LOG_CSV_FIELDS]);
      expect(table.data).toHaveLength(2);
    });
  });
});

describe("given a filtered history longer than one batch", () => {
  describe("when the export plans its walk", () => {
    /** @scenario An export walks the whole filtered history, not just the first batch */
    it("asks for every offset after the first batch", () => {
      expect(auditLogExportOffsets({ totalCount: 12_000 })).toEqual([5000, 10_000]);
    });

    /**
     * The boundary the walk gets wrong if it is written as `<=`: a history of
     * exactly two batches would ask for a third, empty one.
     */
    /** @scenario An export walks the whole filtered history, not just the first batch */
    it("stops at the total rather than one batch past it", () => {
      expect(auditLogExportOffsets({ totalCount: 10_000 })).toEqual([5000]);
    });

    /** @scenario An export walks the whole filtered history, not just the first batch */
    it("asks for nothing more when the first batch already held everything", () => {
      expect(auditLogExportOffsets({ totalCount: 25 })).toEqual([]);
      expect(auditLogExportOffsets({ totalCount: 0 })).toEqual([]);
    });
  });
});
