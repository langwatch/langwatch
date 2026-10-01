/**
 * @vitest-environment node
 * The governance module's own registry, selected via
 * `.withPersistence("memory", {})`: writing then reading through the SAME
 * instances proves the memory tier boots with no Postgres behind it.
 */
import { instantiateRepositories } from "@langwatch/kernel";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { governanceRepositories } from "../governance-repositories.registry.ts";

function memoryTier() {
  return instantiateRepositories(governanceRepositories, {
    tier: "memory",
    members: {},
  });
}

describe("given the memory-backed governance repositories", () => {
  describe("when a department is created", () => {
    it("reads the department back on the organization that owns it", async () => {
      const repositories = memoryTier();

      const created = await repositories.departments.create({
        organizationId: "org-1",
        name: "Platform",
      });

      await expect(repositories.departments.findAll("org-1")).resolves.toMatchObject([
        { id: created.id, name: "Platform" },
      ]);
      await expect(repositories.departments.findAll("org-2")).resolves.toEqual([]);
    });
  });

  describe("when a spend-spike alert is raised", () => {
    it("reports the rule as already alerted inside the dedup window", async () => {
      const repositories = memoryTier();
      const rule = await repositories.anomalyRules.create({
        organizationId: "org-1",
        scope: "organization",
        scopeId: "org-1",
        name: "spend spike",
        description: null,
        severity: "critical",
        ruleType: "spend_spike",
        thresholdConfig: {},
        destinationConfig: {},
        status: "active",
        createdById: "user-1",
      });

      await expect(
        repositories.spendSpikeAnomalies.hasOpenAlert({
          ruleId: rule.id,
          since: fromDate(new Date(0)),
        }),
      ).resolves.toBe(false);

      await repositories.spendSpikeAnomalies.createAlert({
        rule,
        result: {
          ruleId: rule.id,
          organizationId: "org-1",
          decision: "fire",
          reason: "spend doubled against baseline",
          currentSpendUsd: 200,
          baselineSpendUsd: 100,
          windowStart: new Date(0),
          windowEnd: new Date(1_000),
        },
      });

      await expect(
        repositories.spendSpikeAnomalies.hasOpenAlert({
          ruleId: rule.id,
          since: fromDate(new Date(0)),
        }),
      ).resolves.toBe(true);
    });
  });

  describe("when the postgres tier is selected without its store", () => {
    it("refuses the selection by naming the members it needs", () => {
      expect(() =>
        instantiateRepositories(governanceRepositories, {
          tier: "live",
          members: {},
        }),
      ).toThrow(/prisma/);
    });
  });
});
