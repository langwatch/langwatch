/**
 * The runner's step writes mask what the run knows is a secret.
 * Spec: specs/upgrade/step-diagnostics.feature
 */
import { describe, expect, it } from "vitest";

import type { UpgradePostgres } from "../../ports.ts";
import { ledgerRedactor } from "../../step/step-log.ts";
import { UpgradeRunnerRepository } from "../runner-ledger.repository.ts";

const STORE_URL = "https://reader:opaquetoken@clickhouse.internal:8443/langwatch";

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

describe("UpgradeRunnerRepository", () => {
  describe("when a blocking step's failure quotes a store URL the run holds", () => {
    /** @scenario "A blocking step's error naming a store URL is redacted before it is stored" */
    it("stores the error without the URL", async () => {
      const postgres = recordingPostgres();
      const repository = UpgradeRunnerRepository.create({
        postgres,
        redact: ledgerRedactor({ secretValues: [STORE_URL] }),
      });

      await repository.setStatus({
        ids: ["trace:backfill"],
        status: "failed",
        runId: "run_1",
        lastError: `could not reach ${STORE_URL}?secure=1`,
      });

      const stored = postgres.sent.at(-1)?.[3];
      expect(stored).toBe("could not reach ***?secure=1");
    });
  });
});
