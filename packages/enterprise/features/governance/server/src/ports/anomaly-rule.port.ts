import type {
  AnomalyRule,
  AnomalyRuleScope,
  AnomalyRuleSeverity,
  AnomalyRuleStatus,
} from "@langwatch/enterprise-governance-contract";

export type NewAnomalyRule = Omit<
  AnomalyRule,
  "id" | "archivedAt" | "createdAt" | "updatedAt"
>;

export type AnomalyRuleChanges = Partial<
  Pick<
    AnomalyRule,
    | "name"
    | "description"
    | "ruleType"
    | "scopeId"
    | "thresholdConfig"
    | "destinationConfig"
    | "archivedAt"
  >
> & {
  severity?: AnomalyRuleSeverity;
  scope?: AnomalyRuleScope;
  status?: AnomalyRuleStatus;
};

export abstract class AnomalyRuleRepository {
  abstract list(organizationId: string): Promise<AnomalyRule[]>;
  abstract tryFindById(id: string): Promise<AnomalyRule | null>;
  abstract create(input: NewAnomalyRule): Promise<AnomalyRule>;
  abstract update(id: string, changes: AnomalyRuleChanges): Promise<AnomalyRule>;
}
