import type {
  AnomalyAlertDispatchRecord,
  AnomalyRule,
  SpendSpikeEvaluationResult,
} from "@langwatch/enterprise-governance-contract";

export type AnomalySpendSourceFilter =
  | { type: "all" }
  | { type: "source"; id: string }
  | { type: "source_type"; id: string };

export abstract class AnomalySpendReaderPort {
  abstract findSpendTotals(input: {
    tenantId: string;
    windowStart: Date;
    windowEnd: Date;
    baselineStart: Date;
    sourceFilter: AnomalySpendSourceFilter;
  }): Promise<{ currentSpend: number; baselineSpend: number }>;
}

export abstract class SpendSpikeAnomalyRepository {
  abstract listActiveRules(): Promise<AnomalyRule[]>;
  abstract resolveGovernanceTenantId(
    organizationId: string,
  ): Promise<string | null>;
  abstract hasOpenAlert(input: {
    ruleId: string;
    since: Date;
  }): Promise<boolean>;
  abstract createAlert(input: {
    rule: AnomalyRule;
    result: SpendSpikeEvaluationResult;
  }): Promise<AnomalyAlertDispatchRecord>;
  abstract recordDispatch(input: {
    alertId: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
}
