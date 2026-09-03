import { createLogger } from "@langwatch/observability";
import type { GithubHostPort } from "../ports/github-host.port";
import type { GithubProjectActivityPort } from "../ports/github-project-activity.port";
import type {
  BranchMappingTarget,
  GithubBranchMappingService,
} from "./github-branch-mapping.service";

const logger = createLogger("langwatch:github:branch-demand");

export type BranchMappingRequest = {
  tenantId: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  headBranch: string;
};

/** The two mapping operations demand drives, so a caller can double them. */
type BranchMappingOperations = Pick<GithubBranchMappingService, "bringRecheckForward" | "map">;

type GithubBranchDemandDeps = {
  mapping: BranchMappingOperations;
  project: GithubProjectActivityPort;
  host: GithubHostPort;
  now?: () => number;
};

/**
 * A branch somebody is looking at right now, as opposed to one the sweep found.
 *
 * Demand is the only side of pull-request linkage that knows a project: the
 * caller arrives with a tenant, the organization has to be resolved from it,
 * and a mapping that finds a pull request is what marks the project as having
 * seen coding-agent activity. None of that is true of the fleet-wide sweep,
 * which walks branch bookkeeping across every tenant with no project in hand —
 * so keeping the two in one service meant every graph that wanted the sweep
 * composed a project service the sweep never called.
 */
export class GithubBranchDemandService {
  static create(deps: GithubBranchDemandDeps): GithubBranchDemandService {
    return new GithubBranchDemandService(deps);
  }

  private constructor(private readonly deps: GithubBranchDemandDeps) {}

  async request(request: BranchMappingRequest): Promise<void> {
    if (!this.deps.host.isMappable(request.repositoryHost)) {
      return;
    }

    let organizationId: string;
    try {
      organizationId = await this.deps.project.getOrganizationId(request.tenantId);
    } catch {
      return;
    }

    const target: BranchMappingTarget = {
      organizationId,
      repositoryHost: request.repositoryHost,
      repositoryOwner: request.repositoryOwner,
      repositoryName: request.repositoryName,
      headBranch: request.headBranch,
      origin: "demand",
    };
    await this.deps.mapping.bringRecheckForward(target);
    const mapped = await this.deps.mapping.map(target);
    if (mapped > 0) {
      await this.tryRecordProjectActivity(request.tenantId);
    }
  }

  private async tryRecordProjectActivity(projectId: string): Promise<void> {
    try {
      await this.deps.project.touchCodingAgentPullRequestSeen({
        projectId,
        at: new Date(this.deps.now?.() ?? Date.now()),
      });
    } catch (error) {
      logger.warn({ error, projectId }, "failed to record PR project activity");
    }
  }
}
