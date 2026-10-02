import type {
  AnomalyRule,
  CreateAnomalyRuleInput,
} from "@langwatch/enterprise-governance-contract";
import { Temporal, toDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryAnomalyRuleRepository } from "../../repositories/memory/memory.anomaly-rule.repository.ts";
import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { AnomalyRuleService } from "../anomaly-rule.service.ts";

const FIXED_NOW = Temporal.Instant.from("2026-08-24T12:00:00.000Z");

function rule(overrides: Partial<AnomalyRule> = {}): AnomalyRule {
  return {
    id: "rule-1",
    organizationId: "organization-1",
    scope: "organization",
    scopeId: "organization-1",
    name: "Spend spike",
    description: null,
    severity: "warning",
    ruleType: "spend_spike",
    thresholdConfig: {
      windowSec: 3600,
      ratioVsBaseline: 2,
      minBaselineUsd: 1,
    },
    destinationConfig: {},
    status: "active",
    archivedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdById: "user-1",
    ...overrides,
  };
}

function seeded(initial: AnomalyRule[] = []) {
  const store = MemoryGovernanceStore.create();
  store.anomalyRules.push(...initial);
  return { store, repository: MemoryAnomalyRuleRepository.create(store) };
}

function validInput(overrides: Partial<CreateAnomalyRuleInput> = {}): CreateAnomalyRuleInput {
  return {
    organizationId: "organization-1",
    name: "Spend spike",
    severity: "warning",
    ruleType: "spend_spike",
    scope: "organization",
    scopeId: "organization-1",
    thresholdConfig: {
      windowSec: 3600,
      ratioVsBaseline: 2,
      minBaselineUsd: 1,
    },
    actorUserId: "user-1",
    ...overrides,
  };
}

describe("AnomalyRuleService", () => {
  it("validates configuration before creating a rule", async () => {
    const { store, repository } = seeded();
    const service = AnomalyRuleService.create({ repository });

    await expect(
      service.createRule(
        validInput({
          thresholdConfig: { windowSec: -1 },
        }),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(store.anomalyRules).toHaveLength(0);
  });

  it("persists a valid rule through the repository", async () => {
    const { repository } = seeded();
    const created = await AnomalyRuleService.create({ repository }).createRule(validInput());

    expect(created).toMatchObject({
      organizationId: "organization-1",
      status: "active",
      destinationConfig: {},
    });
  });

  /** @scenario "Anomaly rule reads are tenant scoped" */
  it("does not expose a rule owned by another organization", async () => {
    const service = AnomalyRuleService.create({
      repository: seeded([rule()]).repository,
    });

    await expect(
      service.findById({ id: "rule-1", organizationId: "organization-2" }),
    ).resolves.toBeNull();
  });

  it("validates the effective rule type when updating", async () => {
    const { store, repository } = seeded([rule()]);
    const service = AnomalyRuleService.create({ repository });

    await expect(
      service.updateRule({
        id: "rule-1",
        organizationId: "organization-1",
        ruleType: "future_rule",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.anomalyRules.find((item) => item.id === "rule-1")?.ruleType).toBe("spend_spike");
  });

  it("archives using the injected clock", async () => {
    const { repository } = seeded([rule()]);
    const archived = await AnomalyRuleService.create({
      repository,
      now: () => FIXED_NOW,
    }).archive({ id: "rule-1", organizationId: "organization-1" });

    expect(archived.archivedAt).toEqual(toDate(FIXED_NOW));
    expect(archived.status).toBe("disabled");
  });
});
