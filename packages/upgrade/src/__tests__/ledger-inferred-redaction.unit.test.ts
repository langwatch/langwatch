/**
 * A step error seeded from another tool's record is redacted and cut like the runner's own.
 * Spec: specs/upgrade/step-diagnostics.feature
 */
import { describe, expect, it } from "vitest";

import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { UpgradePostgres } from "../ports.ts";
import { LEDGER_TEXT_MAX_CHARS, ledgerRedactor } from "../step/step-log.ts";

const STORE_URL = "postgres://app:opaquetoken@db.internal:5432/langwatch";

/** Answers every statement with no rows and keeps the values each was sent. */
function recordingPostgres(): UpgradePostgres & { sent: unknown[][] } {
  const sent: unknown[][] = [];
  return {
    sent,
    query: async (_text, values) => {
      sent.push(values ?? []);
      return { rows: [] };
    },
  };
}

describe("UpgradeLedgerRepository.writeInferredSteps()", () => {
  describe("when a migration tool's failure log quotes a store URL and runs to 20 KB", () => {
    /** @scenario "A step error read from another tool's record is redacted and cut before it is stored" */
    it("stores the error without the URL, cut to the ledger's limit", async () => {
      const postgres = recordingPostgres();
      const repository = UpgradeLedgerRepository.create({
        postgres,
        redact: ledgerRedactor({ secretValues: [STORE_URL] }),
      });

      await repository.writeInferredSteps({
        runId: "run_1",
        steps: [
          {
            id: "prisma:20261001000000_base",
            kind: "postgres-schema",
            mode: "blocking",
            status: "failed",
            lastError: `could not reach ${STORE_URL}\n${"x".repeat(20_000)}`,
          },
          {
            id: "prisma:20261002000000_next",
            kind: "postgres-schema",
            mode: "blocking",
            status: "pending",
            lastError: null,
          },
        ],
      });

      const [stored, untouched] = postgres.sent.at(-1)?.[4] as (string | null)[];
      expect(stored).not.toContain("opaquetoken");
      expect(stored?.startsWith("could not reach ***")).toBe(true);
      expect(stored?.length).toBeLessThanOrEqual(LEDGER_TEXT_MAX_CHARS);
      expect(stored?.endsWith("[cut]")).toBe(true);
      expect(untouched).toBeNull();
    });
  });
});
