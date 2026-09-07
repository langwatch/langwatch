import type {
  AnomalyAlertDispatchRecord,
  AnomalyRule,
  SpendSpikeEvaluationResult,
} from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

export type AnomalySpendSourceFilter =
  | { type: "all" }
  | { type: "source"; id: string }
  | { type: "source_type"; id: string };

export abstract class AnomalySpendReaderPort {
  abstract findSpendTotals(input: {
    tenantId: string;
    windowStart: Instant;
    windowEnd: Instant;
    baselineStart: Instant;
    sourceFilter: AnomalySpendSourceFilter;
  }): Promise<{ currentSpend: number; baselineSpend: number }>;
}

export abstract class SpendSpikeAnomalyRepository {
  abstract listActiveRules(): Promise<AnomalyRule[]>;
  abstract tryResolveGovernanceTenantId(organizationId: string): Promise<string | null>;
  abstract hasOpenAlert(input: { ruleId: string; since: Instant }): Promise<boolean>;
  abstract createAlert(input: {
    rule: AnomalyRule;
    result: SpendSpikeEvaluationResult;
  }): Promise<AnomalyAlertDispatchRecord>;
  abstract recordDispatch(input: {
    alertId: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
}
