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

/** The canonical application-facing Gateway capability. */
export abstract class GatewayService {
  abstract checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult>;

  abstract list(organizationId: string): Promise<GatewayBudgetWithSeats[]>;
  abstract listForProject(projectId: string): Promise<GatewayBudgetWithSeats[]>;
  abstract listWithHealth(organizationId: string): Promise<GatewayBudgetListWithHealth>;
  abstract listForProjectWithHealth(
    projectId: string,
  ): Promise<GatewayBudgetListWithHealth>;
  abstract listPageWithHealth(
    input: GatewayBudgetPageInput,
  ): Promise<GatewayBudgetListWithHealth>;
  abstract tryGet(
    id: string,
    organizationId: string,
  ): Promise<GatewayBudgetWithSeats | null>;
  abstract tryGetWithHealth(
    id: string,
    organizationId: string,
  ): Promise<GatewayBudgetHealth | null>;
  abstract tryGetDetail(
    id: string,
    organizationId: string,
  ): Promise<GatewayBudgetDetail | null>;
  abstract scopeReach(
    input: GatewayBudgetScopeReachInput,
  ): Promise<GatewayBudgetScopeReachResult>;
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
}
