/**
 * @vitest-environment node
 *
 * The governance module's own registry, selected the way a memory-only
 * process selects it with `.withPersistence("memory", {})`. A write followed
 * by a read through the SAME instances is what proves the memory tier is not
 * a stub: the module boots with no Postgres behind it.
 */
import { instantiateRepositories } from "@langwatch/runtime-composition";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { governanceRepositories } from "../governance-repositories.registry.ts";

function memoryTier() {
  return instantiateRepositories(governanceRepositories, {
    backend: "memory",
    infrastructure: {},
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

      await expect(repositories.departments.getAll("org-1")).resolves.toMatchObject([
        { id: created.id, name: "Platform" },
      ]);
      await expect(repositories.departments.getAll("org-2")).resolves.toEqual([]);
    });
  });

  describe("when a department assignment names a department of another organization", () => {
    it("refuses the assignment rather than crossing the tenant line", async () => {
      const repositories = memoryTier();
      const mine = await repositories.departments.create({
        organizationId: "org-1",
        name: "Platform",
      });

      await expect(
        repositories.departments.assignUser({
          organizationId: "org-2",
          userId: "user-1",
          departmentId: mine.id,
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when a routing policy is made the organization default", () => {
    it("leaves exactly one default behind", async () => {
      const repositories = memoryTier();
      const first = await repositories.routingPolicies.create({
        organizationId: "org-1",
        name: "first",
        modelProviderIds: ["provider-1"],
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        isDefault: true,
        actorUserId: "user-1",
      });
      const second = await repositories.routingPolicies.create({
        organizationId: "org-1",
        name: "second",
        modelProviderIds: ["provider-1"],
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        actorUserId: "user-1",
      });

      await repositories.routingPolicies.setDefault({
        id: second.id,
        organizationId: "org-1",
        actorUserId: "user-1",
      });

      await expect(
        repositories.routingPolicies.findDefaultForUser({ organizationId: "org-1" }),
      ).resolves.toMatchObject({ id: second.id });
      await expect(repositories.routingPolicies.findById(first.id)).resolves.toMatchObject({
        isDefault: false,
      });
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
        repositories.spendSpikeAnomalies.hasOpenAlert({ ruleId: rule.id, since: fromDate(new Date(0)) }),
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
        repositories.spendSpikeAnomalies.hasOpenAlert({ ruleId: rule.id, since: fromDate(new Date(0)) }),
      ).resolves.toBe(true);
    });
  });

  describe("when the postgres tier is selected without its store", () => {
    it("refuses the selection by naming the infrastructure it needs", () => {
      expect(() =>
        instantiateRepositories(governanceRepositories, {
          backend: "postgres",
          infrastructure: {},
        }),
      ).toThrow(/prisma/);
    });
  });
});
