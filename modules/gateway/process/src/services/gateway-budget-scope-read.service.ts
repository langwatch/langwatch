import type {
  GatewayBudgetScopeReachInput,
  GatewayBudgetScopeReachResult,
  GatewayBudgetScopeTarget,
} from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  BudgetListWithHealth,
  GatewayBudgetRepository,
  GatewayKeyReachCandidate,
} from "../repositories/gateway-budget.repository.ts";
import { GatewayBudgetScopeReachService } from "./gateway-budget-scope-reach.service.ts";
import type { GatewayBudgetOrganizations } from "./gateway.service.ts";

/** Where a budget's scope reaches: its active keys, their groups and the targets it names. */
export class GatewayBudgetScopeReadService {
  private readonly reachPolicy = GatewayBudgetScopeReachService.create();

  private constructor(
    private readonly repository: GatewayBudgetRepository,
    private readonly projects: ProjectApi,
    private readonly organizations: GatewayBudgetOrganizations,
  ) {}

  static create({
    repository,
    projects,
    organizations,
  }: {
    repository: GatewayBudgetRepository;
    projects: ProjectApi;
    organizations: GatewayBudgetOrganizations;
  }): GatewayBudgetScopeReadService {
    return new GatewayBudgetScopeReadService(repository, projects, organizations);
  }

  async scopeReach(input: GatewayBudgetScopeReachInput): Promise<GatewayBudgetScopeReachResult> {
    const candidates = await this.reachCandidates({
      organizationId: input.organizationId,
      withGroups: input.scope.scopeType === "GROUP",
    });
    const projectIds = candidates.flatMap((candidate) =>
      candidate.traceProjectId ? [candidate.traceProjectId] : [],
    );
    const traceProjects = await this.projects.listTraceDestinations(projectIds);

    return this.reachPolicy.resolveScope({
      candidates,
      traceProjects,
      scope: input.scope,
    });
  }

  async resolveScopeTargets(
    budgets: { scopeType: string; scopeId: string }[],
    organizationId: string | null,
  ): Promise<Map<string, GatewayBudgetScopeTarget>> {
    const projectIds = budgets
      .filter((budget) => budget.scopeType === "PROJECT" || budget.scopeType === "ATTRIBUTED_USER")
      .map((budget) => budget.scopeId);
    const virtualKeyIds = budgets
      .filter((budget) => budget.scopeType === "VIRTUAL_KEY")
      .map((budget) => budget.scopeId);
    const virtualKeyProjectScopes = await this.repository.findVirtualKeyProjectScopes({
      organizationId,
      virtualKeyIds,
    });
    const projects = await this.projects.listNamesByIds({
      projectIds: [
        ...new Set([...projectIds, ...virtualKeyProjectScopes.map((scope) => scope.projectId)]),
      ],
    });

    return this.repository.resolveScopeTargets({
      budgets,
      organizationId,
      projects,
      virtualKeyProjectScopes,
    });
  }

  async withScopeReach<Result extends BudgetListWithHealth>(
    result: Result,
    organizationId: string,
  ): Promise<Result> {
    const candidates = await this.reachCandidates({
      organizationId,
      withGroups: result.budgets.some((budget) => budget.scopeType === "GROUP"),
    });
    const projectIds = candidates.flatMap((candidate) =>
      candidate.traceProjectId ? [candidate.traceProjectId] : [],
    );
    const traceProjects = await this.projects.listTraceDestinations(projectIds);
    const scopeReach = this.reachPolicy.resolveBudgets({
      candidates,
      traceProjects,
      budgets: result.budgets,
    });

    return { ...result, scopeReach };
  }

  /**
   * The active keys' reach facts. A key's groups are the organization feature's to
   * name, and only a GROUP budget's reach reads them, so they are asked for then.
   */
  private async reachCandidates({
    organizationId,
    withGroups,
  }: {
    organizationId: string;
    withGroups: boolean;
  }): Promise<GatewayKeyReachCandidate[]> {
    const rows = await this.repository.findScopeReachCandidates(organizationId);
    if (!withGroups) {
      return rows.map((row) => ({ ...row, groupIds: [] }));
    }

    const principalUserIds = [
      ...new Set(rows.flatMap((row) => (row.principalUserId ? [row.principalUserId] : []))),
    ];
    const groupIdsByPrincipal = new Map(
      await Promise.all(
        principalUserIds.map(
          async (userId) =>
            [
              userId,
              await this.memberGroupIds({ organizationId, principalUserId: userId }),
            ] as const,
        ),
      ),
    );

    return rows.map((row) => ({
      ...row,
      groupIds: row.principalUserId ? (groupIdsByPrincipal.get(row.principalUserId) ?? []) : [],
    }));
  }

  /** The groups the principal belongs to in this organization; none for a key with no principal. */
  async memberGroupIds({
    organizationId,
    principalUserId,
  }: {
    organizationId: string;
    principalUserId?: string | null | undefined;
  }): Promise<string[]> {
    if (!principalUserId) {
      return [];
    }
    const groups = await this.organizations.listGroupsForMember({
      organizationId,
      userId: principalUserId,
    });

    return groups.map((group) => group.id);
  }
}
