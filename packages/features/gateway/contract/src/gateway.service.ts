import type {
  ArchiveGatewayBudgetInput,
  CreateGatewayBudgetInput,
  GatewayBudgetCheckInput,
  GatewayBudgetCheckResult,
  GatewayBudgetDetail,
  GatewayBudgetHealth,
  GatewayBudgetListWithHealth,
  GatewayBudgetPageInput,
  GatewayBudgetResource,
  GatewayBudgetResolutionTarget,
  GatewayBudgetScopeTarget,
  GatewayBudgetScopeReachInput,
  GatewayBudgetScopeReachResult,
  GatewayBudgetWithSeats,
  GatewayResolvedBudget,
  ResetGatewayBudgetInput,
  UpdateGatewayBudgetInput,
} from "./gateway.budget";
import type {
  ArchiveGatewayCacheRuleInput,
  CreateGatewayCacheRuleInput,
  GatewayCacheRuleCursor,
  GatewayCacheRuleResource,
  UpdateGatewayCacheRuleInput,
} from "./gateway-cache-rule";
import type {
  ArchiveGatewayGuardrailInput,
  CreateGatewayGuardrailInput,
  GatewayGuardrailBundleEntry,
  GatewayGuardrailResource,
  UpdateGatewayGuardrailInput,
} from "./gateway-guardrail";

export type GatewayConfigGuardrailAttachment = {
  direction: "pre" | "post" | "stream_chunk";
  guardrailIds: string[];
};

export type GatewayConfigBundlePersistence = {
  cacheRules: GatewayCacheRuleResource[];
  guardrails: GatewayGuardrailBundleEntry[];
  attachments: GatewayConfigGuardrailAttachment[];
};

/** The canonical application-facing Gateway capability. */
export abstract class GatewayService {
  abstract checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult>;

  abstract list(organizationId: string): Promise<GatewayBudgetWithSeats[]>;
  abstract listForProject(projectId: string): Promise<GatewayBudgetWithSeats[]>;
  abstract listWithHealth(organizationId: string): Promise<GatewayBudgetListWithHealth>;
  abstract listForProjectWithHealth(projectId: string): Promise<GatewayBudgetListWithHealth>;
  abstract listPageWithHealth(input: GatewayBudgetPageInput): Promise<GatewayBudgetListWithHealth>;
  abstract tryGet(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetWithSeats | null>;
  abstract tryGetWithHealth(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetHealth | null>;
  abstract tryGetDetail(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetDetail | null>;
  abstract scopeReach(input: GatewayBudgetScopeReachInput): Promise<GatewayBudgetScopeReachResult>;
  abstract create(input: CreateGatewayBudgetInput): Promise<GatewayBudgetResource>;
  abstract update(input: UpdateGatewayBudgetInput): Promise<GatewayBudgetResource>;
  abstract archive(input: ArchiveGatewayBudgetInput): Promise<GatewayBudgetResource>;
  abstract reset(input: ResetGatewayBudgetInput): Promise<GatewayBudgetResource>;

  /** Internal budget read model shared by API, worker, and Enterprise composition. */
  abstract resolveApplicableBudgets(
    input: GatewayBudgetResolutionTarget,
  ): Promise<GatewayResolvedBudget[]>;
  abstract resolveScopeTargets(
    budgets: Array<{ scopeType: string; scopeId: string }>,
    organizationId: string | null,
  ): Promise<Map<string, GatewayBudgetScopeTarget>>;
  abstract listSpendTenantIds(organizationId: string): Promise<string[]>;

  abstract cacheRuleList(organizationId: string): Promise<GatewayCacheRuleResource[]>;
  abstract cacheRuleListPage(input: {
    organizationId: string;
    limit: number;
    cursor: GatewayCacheRuleCursor | null;
  }): Promise<GatewayCacheRuleResource[]>;
  abstract tryCacheRuleGet(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null>;
  abstract cacheRuleCreate(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  abstract cacheRuleUpdate(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  abstract cacheRuleArchive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;

  abstract guardrailList(projectId: string): Promise<GatewayGuardrailResource[]>;
  abstract tryGuardrailGet(input: {
    id: string;
    projectId: string;
  }): Promise<GatewayGuardrailResource | null>;
  abstract guardrailCreate(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  abstract guardrailUpdate(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  abstract guardrailArchive(input: ArchiveGatewayGuardrailInput): Promise<void>;
  abstract loadConfigurationPersistence(input: {
    organizationId: string;
    traceProjectId: string | null;
    guardrailAttachments: GatewayConfigGuardrailAttachment[];
  }): Promise<GatewayConfigBundlePersistence>;
}
