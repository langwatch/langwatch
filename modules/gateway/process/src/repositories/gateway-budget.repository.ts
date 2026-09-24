import type {
  ArchiveGatewayBudgetInput,
  CreateGatewayBudgetInput,
  GatewayBudgetDetail,
  GatewayBudgetBreachAction,
  GatewayBudgetHealth,
  GatewayBudgetListWithHealth,
  GatewayBudgetPageWithHealth,
  GatewayBudgetPageInput,
  GatewayBudgetResolutionTarget,
  GatewayBudgetResource,
  GatewayBudgetScopeTarget,
  GatewayResolvedBudget,
  ResetGatewayBudgetInput,
  UpdateGatewayBudgetInput,
  GatewayBudgetWithSeats,
  GatewayBudgetWindow,
  GatewayBudgetScopeType,
  GatewayBudgetCheckInput,
  GatewayBudgetCheckResult,
} from "@langwatch/gateway-contract";
import type { ProjectIdentity, TraceDestinationProject } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

export type ArchiveBudgetInput = ArchiveGatewayBudgetInput;
export type BudgetCheckInput = GatewayBudgetCheckInput;
export type BudgetCheckResult = GatewayBudgetCheckResult;
export type BudgetDetail = GatewayBudgetDetail;
export type BudgetHealth = GatewayBudgetHealth;
export type BudgetListWithHealth = GatewayBudgetListWithHealth;
export type BudgetPageWithHealth = GatewayBudgetPageWithHealth;
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

/**
 * One attributed-user budget template, with exactly the fields the end-user
 * cap reader needs — spelled portably so the port carries no generated row
 * type across the repository boundary.
 */
export type AttributedUserBudgetTemplate = {
  id: string;
  scopeType: GatewayBudgetScopeType;
  scopeId: string;
  providerKey: string | null;
  window: GatewayBudgetWindow;
  onBreach: GatewayBudgetBreachAction;
  /** Decimal-like: the money adapters read it through `toString()`. */
  limitUsd: { toString(): string };
  currentPeriodStartedAt: Instant;
  resetsAt: Instant;
  lastResetAt: Instant | null;
  cycleAnchorAt: Instant | null;
};

/** When one budget's bucket last rolled over. */
export type BucketBoundaryRow = {
  budgetId: string;
  bucketScopeId: string;
  periodStartedAt: Instant | null;
};

export abstract class GatewayBudgetRepository {
  abstract check(input: GatewayBudgetCheckReadInput): Promise<BudgetCheckResult>;
  abstract findAll(input: GatewayOrganizationBudgetReadInput): Promise<GatewayBudgetWithSeats[]>;
  abstract findForProject(input: GatewayProjectBudgetReadInput): Promise<GatewayBudgetWithSeats[]>;
  abstract findWithHealth(input: GatewayOrganizationBudgetReadInput): Promise<BudgetListWithHealth>;
  abstract listPageWithHealth(
    input: GatewayBudgetPageInput & GatewayOrganizationBudgetReadInput,
  ): Promise<BudgetPageWithHealth>;
  abstract findForProjectWithHealth(
    input: GatewayProjectBudgetReadInput,
  ): Promise<BudgetListWithHealth>;
  abstract findById(input: GatewayBudgetReadInput): Promise<GatewayBudgetWithSeats | null>;
  abstract findHealthById(input: GatewayBudgetReadInput): Promise<BudgetHealth | null>;
  abstract findDetailById(input: GatewayBudgetReadInput): Promise<BudgetDetail | null>;
  abstract findScopeReachCandidates(organizationId: string): Promise<GatewayKeyReachCandidate[]>;
  abstract create(input: CreateBudgetInput): Promise<GatewayBudgetResource>;
  abstract update(input: UpdateBudgetInput): Promise<GatewayBudgetResource>;
  abstract archive(input: ArchiveBudgetInput): Promise<GatewayBudgetResource>;
  abstract reset(input: ResetGatewayBudgetInput): Promise<GatewayBudgetResource>;
  abstract resolveApplicableBudgets(
    input: GatewayBudgetResolutionTarget,
  ): Promise<GatewayResolvedBudget[]>;
  abstract resolveScopeTargets(
    budgets: { scopeType: string; scopeId: string }[],
    organizationId: string | null,
    projects: ProjectIdentity[],
    virtualKeyProjectScopes: GatewayVirtualKeyProjectScope[],
  ): Promise<Map<string, GatewayBudgetScopeTarget>>;
  /**
   * The attributed-user budget templates an end user's caps read from, and
   * the bucket boundaries for when each period started. Two reads, not one
   * join: boundaries key by budget AND bucket scope, which only the caller knows.
   */
  abstract findAttributedUserTemplates(input: {
    organizationId: string;
    virtualKeyId?: string;
  }): Promise<AttributedUserBudgetTemplate[]>;
  abstract findBucketBoundaries(input: {
    organizationId: string;
    budgetIds: string[];
  }): Promise<BucketBoundaryRow[]>;

  abstract findVirtualKeyProjectScopes(input: {
    organizationId: string | null;
    virtualKeyIds: string[];
  }): Promise<GatewayVirtualKeyProjectScope[]>;
}
