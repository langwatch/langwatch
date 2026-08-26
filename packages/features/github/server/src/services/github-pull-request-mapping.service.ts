import type {
  GithubPullRequest,
  GithubPullRequestEvent,
} from "@langwatch/github-contract";

import type { GithubPullRequestsRepository } from "../repositories/github-pull-requests.repository";
import type { GithubBranchMaintenanceService } from "./github-branch-maintenance.service";
import type {
  BranchMappingRequest,
  GithubBranchMappingService,
} from "./github-branch-mapping.service";

export type { BranchMappingRequest } from "./github-branch-mapping.service";

export class GithubPullRequestMappingService {
  static create(deps: {
    repository: GithubPullRequestsRepository;
    branches: GithubBranchMappingService;
    maintenance: GithubBranchMaintenanceService;
  }): GithubPullRequestMappingService {
    return new GithubPullRequestMappingService(
      deps.repository,
      deps.branches,
      deps.maintenance,
    );
  }

  private constructor(
    private readonly repository: GithubPullRequestsRepository,
    private readonly branches: GithubBranchMappingService,
    private readonly maintenance: GithubBranchMaintenanceService,
  ) {}

  findForBranches(input: {
    organizationId: string;
    keys: ReadonlyArray<{
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }>;
  }): Promise<readonly GithubPullRequest[]> {
    return this.repository.findAllByBranchKeys(input);
  }

  findAllByBranches(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranches: readonly string[];
  }): Promise<readonly GithubPullRequest[]> {
    return this.repository.findAllByBranches(input);
  }

  tryFindByNumber(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequest | null> {
    return this.repository.tryFindByNumber(input);
  }

  requestBranchMapping(request: BranchMappingRequest): Promise<void> {
    return this.branches.request(request);
  }

  applyPullRequestEvent(event: GithubPullRequestEvent): Promise<boolean> {
    return this.branches.applyPullRequestEvent(event);
  }

  recheckDueBranches(): Promise<number> {
    return this.maintenance.recheckDueBranches();
  }

  pruneStaleBranchLinkage(): Promise<{ branchChecks: number }> {
    return this.maintenance.pruneStaleBranchLinkage();
  }
}
