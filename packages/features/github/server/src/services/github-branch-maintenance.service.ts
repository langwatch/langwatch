import type { GithubPullRequestsRepository } from "../repositories/github-pull-requests.repository";
import type {
  BranchMappingTarget,
  GithubBranchMappingService,
} from "./github-branch-mapping.service";

const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type GithubBranchMaintenanceDeps = {
  repository: GithubPullRequestsRepository;
  mapping: GithubBranchMappingService;
  now?: () => number;
};

export class GithubBranchMaintenanceService {
  static create(deps: GithubBranchMaintenanceDeps): GithubBranchMaintenanceService {
    return new GithubBranchMaintenanceService(deps);
  }

  private constructor(private readonly deps: GithubBranchMaintenanceDeps) {}

  async recheckDueBranches(): Promise<number> {
    const now = this.deps.now?.() ?? Date.now();
    const due = await this.deps.repository.findRecheckDue({
      now: new Date(now),
      activeWithinMs: ACTIVE_WINDOW_MS,
      limit: 50,
    });

    for (const row of due) {
      const target = this.tryTarget(row);
      if (target) {
        await this.deps.mapping.map(target);
      }
    }
    return due.length;
  }

  pruneStaleBranchLinkage(): Promise<{ branchChecks: number }> {
    const now = this.deps.now?.() ?? Date.now();
    return this.deps.repository.deleteStaleBefore({
      before: new Date(now - ACTIVE_WINDOW_MS),
    });
  }

  private tryTarget(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
  }): BranchMappingTarget | null {
    const [repositoryOwner, repositoryName] = input.repositoryFullName.split("/");
    if (!repositoryOwner || !repositoryName) {
      return null;
    }

    return {
      organizationId: input.organizationId,
      repositoryHost: input.repositoryHost,
      repositoryOwner,
      repositoryName,
      headBranch: input.headBranch,
      origin: "sweep",
    };
  }
}
