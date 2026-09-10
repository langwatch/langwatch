// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AnomalyRule } from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import {
  AnomalyRulePort,
  type AnomalyRuleChanges,
  type NewAnomalyRule,
} from "../../ports/anomaly-rule.port.ts";
import type { MemoryGovernanceStore } from "./memory-governance.store.ts";

const ANOMALY_RULE_KSUID_RESOURCE = "anomrule";

/** The anomaly-rule twin: the organization's rules, newest write last. */
export class MemoryAnomalyRuleRepository extends AnomalyRulePort {
  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemoryAnomalyRuleRepository {
    return new MemoryAnomalyRuleRepository(store);
  }

  async list(organizationId: string): Promise<AnomalyRule[]> {
    return this.store.anomalyRules.filter(
      (rule) => rule.organizationId === organizationId && rule.archivedAt === null,
    );
  }

  async tryFindById(id: string): Promise<AnomalyRule | null> {
    return this.store.anomalyRules.find((rule) => rule.id === id) ?? null;
  }

  async create(input: NewAnomalyRule): Promise<AnomalyRule> {
    const now = new Date();
    const rule: AnomalyRule = {
      ...input,
      id: generate(ANOMALY_RULE_KSUID_RESOURCE).toString(),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.anomalyRules.push(rule);
    return rule;
  }

  async update(id: string, changes: AnomalyRuleChanges): Promise<AnomalyRule> {
    const index = this.store.anomalyRules.findIndex((rule) => rule.id === id);
    if (index < 0) throw new Error(`No anomaly rule ${id}`);
    const updated: AnomalyRule = {
      ...this.store.anomalyRules[index]!,
      ...changes,
      updatedAt: new Date(),
    };
    this.store.anomalyRules[index] = updated;
    return updated;
  }
}
