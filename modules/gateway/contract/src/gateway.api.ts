/**
 * The AI Gateway's portable capability: the operations a process's own doors
 * call, and the one budget-resolution read the spend graph makes into this
 * module. It replaces the abstract `GatewayService` the contract used to
 * carry - an interface plus its token, never a class to inherit from.
 */
import { moduleApi } from "@langwatch/runtime-composition";

import type {
  ArchiveGatewayBudgetInput,
  CreateGatewayBudgetInput,
  GatewayBudgetDetail,
  GatewayBudgetListWithHealth,
  GatewayBudgetResolutionTarget,
  GatewayBudgetResource,
  GatewayBudgetScopeTarget,
  GatewayResolvedBudget,
  ResetGatewayBudgetInput,
  UpdateGatewayBudgetInput,
} from "./gateway.budget.ts";
import type {
  ArchiveGatewayCacheRuleInput,
  CreateGatewayCacheRuleInput,
  GatewayCacheRuleResource,
  UpdateGatewayCacheRuleInput,
} from "./gateway-cache-rule.ts";
import type {
  ArchiveGatewayGuardrailInput,
  CreateGatewayGuardrailInput,
  GatewayGuardrailResource,
  UpdateGatewayGuardrailInput,
} from "./gateway-guardrail.ts";

/** One group a per-member allowance can be pointed at. */
export type GatewayGroupTarget = Readonly<{ id: string; name: string; memberCount: number }>;

/** Callable gateway capability shared by API, worker, and task processes. */
export interface GatewayApi {
  /** Refuses an organization id that names no organization. */
  assertOrganizationExists(organizationId: string): Promise<void>;
  /** The organization a project belongs to, or null when the project is unknown. */
  findProjectOrganization(projectId: string): Promise<string | null>;

  listBudgetsWithHealth(organizationId: string): Promise<GatewayBudgetListWithHealth>;
  listProjectBudgetsWithHealth(projectId: string): Promise<GatewayBudgetListWithHealth>;
  listBudgetScopeTargets(
    budgets: Array<{ scopeType: string; scopeId: string }>,
    organizationId: string | null,
  ): Promise<Map<string, GatewayBudgetScopeTarget>>;
  findBudgetDetail(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayBudgetDetail | null>;
  createBudget(input: CreateGatewayBudgetInput): Promise<GatewayBudgetResource>;
  updateBudget(input: UpdateGatewayBudgetInput): Promise<GatewayBudgetResource>;
  archiveBudget(input: ArchiveGatewayBudgetInput): Promise<GatewayBudgetResource>;
  resetBudget(input: ResetGatewayBudgetInput): Promise<GatewayBudgetResource>;
  /** Provider row id to its display label, for a whole page in one read. */
  resolveProviderLabels(
    budgets: ReadonlyArray<{ providerKey: string | null }>,
  ): Promise<Map<string, string>>;
  listGroupTargets(organizationId: string): Promise<ReadonlyArray<GatewayGroupTarget>>;
  /** The budgets one debit lands on, as the spend graph resolves them. */
  resolveApplicableBudgets(
    input: GatewayBudgetResolutionTarget,
  ): Promise<GatewayResolvedBudget[]>;

  listCacheRules(organizationId: string): Promise<GatewayCacheRuleResource[]>;
  findCacheRule(input: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null>;
  createCacheRule(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  updateCacheRule(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;
  archiveCacheRule(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource>;

  listGuardrails(projectId: string): Promise<GatewayGuardrailResource[]>;
  findGuardrail(input: {
    id: string;
    projectId: string;
  }): Promise<GatewayGuardrailResource | null>;
  createGuardrail(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  updateGuardrail(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource>;
  archiveGuardrail(input: ArchiveGatewayGuardrailInput): Promise<void>;
}

export const GatewayApi = moduleApi<GatewayApi>("gateway");
