/**
 * ClickHouse is mandatory (rounds 20 and 22): `servingUpgradeGate` refuses a database with no
 * ClickHouse by name, before it opens a connection. Spec: specs/upgrade/entry-points.feature.
 */
import { storesOwner } from "@langwatch/process-stores/config";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { NO_CLICKHOUSE_REFUSAL, servingUpgradeGate } from "../serving-upgrade-gate.ts";

function secretsFrom(environment: Record<string, string>) {
  const declared = Object.values(storesOwner.secrets);
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  return resolver.scopeTo("serving-clickhouse-test", declared);
}

describe("servingUpgradeGate", () => {
  describe("given a database and no ClickHouse target", () => {
    /** @scenario "A process with no ClickHouse configured refuses to serve, naming ClickHouse" */
    it("refuses by name and never serves", async () => {
      const gate = await servingUpgradeGate({
        secrets: secretsFrom({ DATABASE_URL: "postgresql://never-opened:5432/langwatch" }),
        role: "worker",
      });

      const verdict = await gate.admit();

      expect(verdict).toMatchObject({ admitted: false, outcome: "no-clickhouse" });
      expect(verdict.admitted ? "" : verdict.refusal).toBe(NO_CLICKHOUSE_REFUSAL);
      expect(verdict.admitted ? "" : verdict.refusal).toContain("CLICKHOUSE_URL");
      expect(gate.serving?.()).toBe(false);
    });
  });

  describe("given no database", () => {
    /** @scenario "A process with no database configured has no installation to gate" */
    it("admits without reading a ledger", async () => {
      const gate = await servingUpgradeGate({ secrets: secretsFrom({}), role: "api" });

      await expect(gate.admit()).resolves.toEqual({ admitted: true, outcome: "current" });
      expect(gate.serving?.()).toBe(true);
    });
  });
});
