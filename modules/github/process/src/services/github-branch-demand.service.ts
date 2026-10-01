import { createLogger } from "@langwatch/observability";
import { Temporal, nowInstant } from "@langwatch/time";

import type { GithubHost, GithubProjectActivity } from "../app/github.members.ts";
import type {
  BranchMappingTarget,
  GithubBranchMappingService,
} from "./github-branch-mapping.service.ts";

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
  project: GithubProjectActivity;
  host: GithubHost;
  now?: () => number;
};

/**
 * Branch demand: knows a project and marks activity. Separate from sweep
 * because the sweep walks every tenant with no project.
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
        at: Temporal.Instant.fromEpochMilliseconds(
          this.deps.now?.() ?? nowInstant().epochMilliseconds,
        ),
      });
    } catch (error) {
      logger.warn({ error, projectId }, "failed to record PR project activity");
    }
  }
}
