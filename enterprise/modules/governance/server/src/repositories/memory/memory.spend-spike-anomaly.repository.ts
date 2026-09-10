// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  AnomalyAlertDispatchRecord,
  AnomalyRule,
  SpendSpikeEvaluationResult,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import type { Instant } from "@langwatch/time";
import { toDate } from "@langwatch/time";
import { SpendSpikeAnomalyRepository } from "../policy/spend-spike-anomaly.repository.ts";
import type { MemoryGovernanceStore } from "./memory-governance.store.ts";

const ANOMALY_ALERT_KSUID_RESOURCE = "anomalert";

/**
 * The spend-spike twin. Alerts read each other's writes through the shared
 * store, so an alert raised in one call is what `hasOpenAlert` sees in the
 * next - the dedup window the evaluator relies on.
 */
export class MemorySpendSpikeAnomalyRepository extends SpendSpikeAnomalyRepository {
  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemorySpendSpikeAnomalyRepository {
    return new MemorySpendSpikeAnomalyRepository(store);
  }

  async listActiveRules(): Promise<AnomalyRule[]> {
    return this.store.anomalyRules.filter(
      (rule) => rule.archivedAt === null && rule.status === "active",
    );
  }

  async findGovernanceTenantId(organizationId: string): Promise<string | null> {
    return this.store.governanceTenantIds.get(organizationId) ?? null;
  }

  async hasOpenAlert(input: { ruleId: string; since: Instant }): Promise<boolean> {
    const since = toDate(input.since).getTime();
    return this.store.alerts.some(
      (alert) =>
        alert.ruleId === input.ruleId && alert.open && alert.detectedAt.getTime() >= since,
    );
  }

  async createAlert(input: {
    rule: AnomalyRule;
    result: SpendSpikeEvaluationResult;
  }): Promise<AnomalyAlertDispatchRecord> {
    const detectedAt = new Date();
    const alert = {
      id: generate(ANOMALY_ALERT_KSUID_RESOURCE).toString(),
      triggerWindowStart: detectedAt,
      triggerWindowEnd: detectedAt,
      triggerSpendUsd: null,
      triggerEventCount: null,
      detail: input.result,
      detectedAt,
      ruleId: input.rule.id,
      open: true,
      dispatches: [],
    };
    this.store.alerts.push(alert);
    return alert;
  }

  async recordDispatch(input: {
    alertId: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    this.store.alerts.find((alert) => alert.id === input.alertId)?.dispatches.push(input.detail);
  }
}
