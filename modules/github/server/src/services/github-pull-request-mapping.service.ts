import type { GithubPullRequest, GithubPullRequestEvent } from "@langwatch/github-contract";

import { toDate } from "@langwatch/time";
import type {
  GithubPullRequestRow,
  GithubPullRequestsRepository,
} from "../repositories/github-pull-requests.repository.ts";
import type {
  BranchMappingRequest,
  GithubBranchDemandService,
} from "./github-branch-demand.service.ts";
import type { GithubBranchMaintenanceService } from "./github-branch-maintenance.service.ts";
import type { GithubBranchMappingService } from "./github-branch-mapping.service.ts";

export type { BranchMappingRequest } from "./github-branch-demand.service.ts";

/** One stored snapshot, as the contract carries it: instants become the wire's dates. */
function toContractPullRequest(row: GithubPullRequestRow): GithubPullRequest {
  return {
    ...row,
    prCreatedAt: toDate(row.prCreatedAt),
    prClosedAt: row.prClosedAt && toDate(row.prClosedAt),
    prMergedAt: row.prMergedAt && toDate(row.prMergedAt),
    prUpdatedAt: row.prUpdatedAt && toDate(row.prUpdatedAt),
    mappedAt: toDate(row.mappedAt),
    lastCheckedAt: toDate(row.lastCheckedAt),
  };
}

export class GithubPullRequestMappingService {
  static create(deps: {
    repository: GithubPullRequestsRepository;
    branches: GithubBranchMappingService;
    demand: GithubBranchDemandService;
    maintenance: GithubBranchMaintenanceService;
  }): GithubPullRequestMappingService {
    return new GithubPullRequestMappingService(
      deps.repository,
      deps.branches,
      deps.demand,
      deps.maintenance,
    );
  }

  private constructor(
    private readonly repository: GithubPullRequestsRepository,
    private readonly branches: GithubBranchMappingService,
    private readonly demand: GithubBranchDemandService,
    private readonly maintenance: GithubBranchMaintenanceService,
  ) {}

  async findForBranches(input: {
    organizationId: string;
    keys: ReadonlyArray<{
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }>;
  }): Promise<readonly GithubPullRequest[]> {
    const rows = await this.repository.findAllByBranchKeys(input);

    return rows.map(toContractPullRequest);
  }

  async findAllByBranches(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranches: readonly string[];
  }): Promise<readonly GithubPullRequest[]> {
    const rows = await this.repository.findAllByBranches(input);

    return rows.map(toContractPullRequest);
  }

  async findByNumber(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequest | null> {
    const row = await this.repository.findByNumber(input);

    return row ? toContractPullRequest(row) : null;
  }

  requestBranchMapping(request: BranchMappingRequest): Promise<void> {
    return this.demand.request(request);
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
