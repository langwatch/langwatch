/**
 * @vitest-environment node
 * A module reads its own step's ledger record while serving: status, report and start instant.
 */
import { describe, expect, it } from "vitest";

import type { UpgradePostgres } from "../../ports.ts";
import { findLedgerStepRecords } from "../step-record.ts";

const STEP_ID = "trace:replay-span-analytics";

/** A database whose ledger step table holds `rows`, or has no ledger at all. */
function ledgerHolding({
  rows,
  ledger = true,
}: {
  rows: Record<string, unknown>[];
  ledger?: boolean;
}): UpgradePostgres {
  return {
    query: async <Row extends object>(text: string, values?: unknown[]) => {
      if (text.includes('AS "schema"')) return { rows: [{ schema: "public" } as Row] };
      if (text.includes("to_regclass")) {
        const present = { step: ledger, run: ledger, lease: false, target: false, roster: false };
        return { rows: [present as Row] };
      }
      if (text.includes("to_jsonb(step)")) {
        const matching = rows.filter((row) => row.id === values?.[0]);
        return { rows: matching.map((row) => ({ row }) as Row) };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

describe("findLedgerStepRecords", () => {
  describe("given a ledger row for the step", () => {
    it("returns its status and report, and its started_at as a UTC startedAt", async () => {
      const postgres = ledgerHolding({
        rows: [
          {
            id: STEP_ID,
            kind: "data",
            mode: "background",
            status: "running",
            report: { since: "2026-09-10T00:00:00.000Z" },
            started_at: "2026-11-10T10:00:00.000",
          },
          { id: "another.step", kind: "data", mode: "background", status: "done" },
        ],
      });

      await expect(findLedgerStepRecords({ postgres, id: STEP_ID })).resolves.toEqual([
        {
          status: "running",
          report: { since: "2026-09-10T00:00:00.000Z" },
          startedAt: "2026-11-10T10:00:00.000Z",
        },
      ]);
    });
  });

  describe("given a ledger with no row for the step", () => {
    it("returns no records", async () => {
      const postgres = ledgerHolding({ rows: [] });

      await expect(findLedgerStepRecords({ postgres, id: STEP_ID })).resolves.toEqual([]);
    });
  });

  describe("given a database with no ledger yet", () => {
    it("returns no records", async () => {
      const postgres = ledgerHolding({ rows: [], ledger: false });

      await expect(findLedgerStepRecords({ postgres, id: STEP_ID })).resolves.toEqual([]);
    });
  });
});
