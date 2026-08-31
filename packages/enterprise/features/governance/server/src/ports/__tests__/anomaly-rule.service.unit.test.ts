import type {
  AnomalyRule,
  CreateAnomalyRuleInput,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";
import {
  AnomalyRuleRepository,
  type AnomalyRuleChanges,
  type NewAnomalyRule,
} from "../anomaly-rule.port";
import { AnomalyRuleService } from "../../services/anomaly-rule.service";

const FIXED_NOW = new Date("2026-08-24T12:00:00.000Z");

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

class MemoryAnomalyRuleRepository extends AnomalyRuleRepository {
  readonly rows = new Map<string, AnomalyRule>();

  constructor(initial: AnomalyRule[] = []) {
    super();
    for (const item of initial) this.rows.set(item.id, item);
  }

  async list(organizationId: string): Promise<AnomalyRule[]> {
    return [...this.rows.values()].filter(
      (item) => item.organizationId === organizationId && item.archivedAt === null,
    );
  }

  async tryFindById(id: string): Promise<AnomalyRule | null> {
    return this.rows.get(id) ?? null;
  }

  async create(input: NewAnomalyRule): Promise<AnomalyRule> {
    const created = rule({ ...input, id: `rule-${this.rows.size + 1}` });
    this.rows.set(created.id, created);
    return created;
  }

  async update(id: string, changes: AnomalyRuleChanges): Promise<AnomalyRule> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error("missing fixture rule");
    const updated = { ...existing, ...changes };
    this.rows.set(id, updated);
    return updated;
  }
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
    const repository = new MemoryAnomalyRuleRepository();
    const service = AnomalyRuleService.create({ repository });

    await expect(
      service.createRule(
        validInput({
          thresholdConfig: { windowSec: -1 },
        }),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(repository.rows.size).toBe(0);
  });

  it("persists a valid rule through the repository", async () => {
    const repository = new MemoryAnomalyRuleRepository();
    const created = await AnomalyRuleService.create({ repository }).createRule(validInput());

    expect(created).toMatchObject({
      organizationId: "organization-1",
      status: "active",
      destinationConfig: {},
    });
  });

  it("does not expose a rule owned by another organization", async () => {
    const service = AnomalyRuleService.create({
      repository: new MemoryAnomalyRuleRepository([rule()]),
    });

    await expect(
      service.tryFindById({ id: "rule-1", organizationId: "organization-2" }),
    ).resolves.toBeNull();
  });

  it("validates the effective rule type when updating", async () => {
    const repository = new MemoryAnomalyRuleRepository([rule()]);
    const service = AnomalyRuleService.create({ repository });

    await expect(
      service.updateRule({
        id: "rule-1",
        organizationId: "organization-1",
        ruleType: "future_rule",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(repository.rows.get("rule-1")?.ruleType).toBe("spend_spike");
  });

  it("archives using the injected clock", async () => {
    const repository = new MemoryAnomalyRuleRepository([rule()]);
    const archived = await AnomalyRuleService.create({
      repository,
      now: () => FIXED_NOW,
    }).archive({ id: "rule-1", organizationId: "organization-1" });

    expect(archived.archivedAt).toBe(FIXED_NOW);
    expect(archived.status).toBe("disabled");
  });
});
