import type { TraceDestinationProject } from "@langwatch/project-contract";
import type {
  GatewayBudgetScope,
  GatewayBudgetScopeReach,
  GatewayKeyReachCandidate,
  ScopeReach,
} from "../repositories/gateway-budget.repository";

type KeyReach = GatewayKeyReachCandidate & {
  projectId: string | null;
  teamIds: string[];
};

/** Gateway policy for determining whether active keys can reach a budget scope. */
export class GatewayBudgetScopeReachService {
  private constructor() {}

  static create(): GatewayBudgetScopeReachService {
    return new GatewayBudgetScopeReachService();
  }

  resolveBudgets(input: {
    candidates: GatewayKeyReachCandidate[];
    traceProjects: TraceDestinationProject[];
    budgets: Array<GatewayBudgetScope & { id: string }>;
  }): Map<string, GatewayBudgetScopeReach> {
    const keys = this.keyReach(input.candidates, input.traceProjects);
    const reachableProjectIds = this.reachableProjectIds(keys);
    const reach = new Map<string, GatewayBudgetScopeReach>();
    for (const budget of input.budgets) {
      reach.set(budget.id, {
        budgetId: budget.id,
        reachable: keys.some((key) => this.matches({ budget, key })),
        reachableProjectIds,
      });
    }
    return reach;
  }

  resolveScope(input: {
    candidates: GatewayKeyReachCandidate[];
    traceProjects: TraceDestinationProject[];
    scope: GatewayBudgetScope;
  }): ScopeReach {
    const keys = this.keyReach(input.candidates, input.traceProjects);
    return {
      reachable: keys.some((key) => this.matches({ budget: input.scope, key })),
      reachableProjectIds: this.reachableProjectIds(keys),
      activeKeyCount: keys.length,
    };
  }

  private keyReach(
    candidates: GatewayKeyReachCandidate[],
    projects: TraceDestinationProject[],
  ): KeyReach[] {
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    return candidates.map((candidate) => {
      const project = candidate.traceProjectId
        ? projectsById.get(candidate.traceProjectId)
        : undefined;
      const teamIds = new Set(candidate.scopedTeamIds);
      if (project) {
        teamIds.add(project.teamId);
      }
      return { ...candidate, teamIds: [...teamIds], projectId: project?.id ?? null };
    });
  }

  private matches({ budget, key }: { budget: GatewayBudgetScope; key: KeyReach }): boolean {
    switch (budget.scopeType) {
      case "ORGANIZATION":
        return budget.scopeId === key.organizationId;
      case "TEAM":
        return key.teamIds.includes(budget.scopeId);
      case "PROJECT":
        return budget.scopeId === key.projectId;
      case "VIRTUAL_KEY":
        return budget.scopeId === key.virtualKeyId;
      case "PRINCIPAL":
        return budget.scopeId === key.principalUserId;
      case "ATTRIBUTED_USER":
        return budget.scopeId === key.virtualKeyId || budget.scopeId === key.projectId;
      case "GROUP":
        return key.groupIds.includes(budget.scopeId);
      default:
        throw new Error(`Unsupported Gateway budget scope: ${budget.scopeType}`);
    }
  }

  private reachableProjectIds(keys: KeyReach[]): string[] {
    return [...new Set(keys.flatMap((key) => (key.projectId ? [key.projectId] : [])))];
  }
}
