import type {
  ArchiveGatewayBudgetInput,
  CreateGatewayBudgetInput,
  GatewayBudgetDetail,
  GatewayBudgetHealth,
  GatewayBudgetListWithHealth,
  GatewayBudgetPageInput,
  GatewayBudgetResolutionTarget,
  GatewayBudgetResource,
  GatewayBudgetScopeTarget,
  GatewayResolvedBudget,
  ResetGatewayBudgetInput,
  UpdateGatewayBudgetInput,
  GatewayBudgetWithSeats,
} from "@langwatch/gateway-contract";
import type { ProjectIdentity, TraceDestinationProject } from "@langwatch/project-contract";
import type {
  GatewayBudgetCheckInput,
  GatewayBudgetCheckResult,
} from "@langwatch/gateway-contract";

export type ArchiveBudgetInput = ArchiveGatewayBudgetInput;
export type BudgetCheckInput = GatewayBudgetCheckInput;
export type BudgetCheckResult = GatewayBudgetCheckResult;
export type BudgetDetail = GatewayBudgetDetail;
export type BudgetHealth = GatewayBudgetHealth;
export type BudgetListWithHealth = GatewayBudgetListWithHealth;
export type CreateBudgetInput = CreateGatewayBudgetInput;
export type UpdateBudgetInput = UpdateGatewayBudgetInput;

export type GatewayProjectBudgetScopeInput = {
  organizationId: string;
  teamId: string;
  projectId: string;
};
export type GatewayKeyReachCandidate = {
  organizationId: string;
  scopedTeamIds: string[];
  traceProjectId: string | null;
  virtualKeyId: string;
  principalUserId: string | null;
  groupIds: string[];
};

export type ScopeReach = {
  reachable: boolean;
  reachableProjectIds: string[];
  activeKeyCount: number;
};

export type GatewayBudgetScopeReach = {
  budgetId: string;
  reachable: boolean;
  reachableProjectIds: string[];
};

export type GatewayBudgetScope = {
  scopeType:
    | "ORGANIZATION"
    | "TEAM"
    | "PROJECT"
    | "VIRTUAL_KEY"
    | "PRINCIPAL"
    | "GROUP"
    | "ATTRIBUTED_USER";
  scopeId: string;
};

export type GatewayBudgetReachInput = {
  candidates: GatewayKeyReachCandidate[];
  traceProjects: TraceDestinationProject[];
};

export type GatewayOrganizationBudgetReadInput = {
  organizationId: string;
  tenantIds: string[];
};

export type GatewayProjectBudgetReadInput = GatewayProjectBudgetScopeInput & {
  tenantIds: string[];
};

export type GatewayBudgetReadInput = GatewayOrganizationBudgetReadInput & {
  id: string;
};

export type GatewayBudgetCheckReadInput = BudgetCheckInput & {
  tenantIds: string[];
};

export type GatewayVirtualKeyProjectScope = {
  virtualKeyId: string;
  projectId: string;
};

export abstract class GatewayBudgetRepository {
  abstract check(input: GatewayBudgetCheckReadInput): Promise<BudgetCheckResult>;
  abstract list(
    input: GatewayOrganizationBudgetReadInput,
  ): Promise<GatewayBudgetWithSeats[]>;
  abstract listForProject(
    input: GatewayProjectBudgetReadInput,
  ): Promise<GatewayBudgetWithSeats[]>;
  abstract listWithHealth(
    input: GatewayOrganizationBudgetReadInput,
  ): Promise<BudgetListWithHealth>;
  abstract listPageWithHealth(
    input: GatewayBudgetPageInput & GatewayOrganizationBudgetReadInput,
  ): Promise<BudgetListWithHealth>;
  abstract listForProjectWithHealth(
    input: GatewayProjectBudgetReadInput,
  ): Promise<BudgetListWithHealth>;
  abstract tryGet(input: GatewayBudgetReadInput): Promise<GatewayBudgetWithSeats | null>;
  abstract tryGetWithHealth(input: GatewayBudgetReadInput): Promise<BudgetHealth | null>;
  abstract tryGetDetail(input: GatewayBudgetReadInput): Promise<BudgetDetail | null>;
  abstract listScopeReachCandidates(
    organizationId: string,
  ): Promise<GatewayKeyReachCandidate[]>;
  abstract create(input: CreateBudgetInput): Promise<GatewayBudgetResource>;
  abstract update(input: UpdateBudgetInput): Promise<GatewayBudgetResource>;
  abstract archive(input: ArchiveBudgetInput): Promise<GatewayBudgetResource>;
  abstract reset(input: ResetGatewayBudgetInput): Promise<GatewayBudgetResource>;
  abstract resolveApplicableBudgets(
    input: GatewayBudgetResolutionTarget,
  ): Promise<GatewayResolvedBudget[]>;
  abstract resolveScopeTargets(
    budgets: Array<{ scopeType: string; scopeId: string }>,
    organizationId: string | null,
    projects: ProjectIdentity[],
    virtualKeyProjectScopes: GatewayVirtualKeyProjectScope[],
  ): Promise<Map<string, GatewayBudgetScopeTarget>>;
  abstract listVirtualKeyProjectScopes(input: {
    organizationId: string | null;
    virtualKeyIds: string[];
  }): Promise<GatewayVirtualKeyProjectScope[]>;
}
