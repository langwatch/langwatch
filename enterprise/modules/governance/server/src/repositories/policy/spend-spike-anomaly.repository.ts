import type {
  AnomalyAlertDispatchRecord,
  AnomalyRule,
  SpendSpikeEvaluationResult,
} from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

export abstract class SpendSpikeAnomalyRepository {
  abstract listActiveRules(): Promise<AnomalyRule[]>;
  abstract findGovernanceTenantId(organizationId: string): Promise<string | null>;
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
