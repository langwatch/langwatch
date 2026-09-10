import {
  codingAgentPullRequestMappingBackfillInputSchema,
  type CodingAgentPullRequestMappingBackfillInput,
  type CodingAgentSession,
} from "@langwatch/coding-agent-contract";
import { createLogger } from "@langwatch/observability";
import type { GithubApi } from "@langwatch/github-contract";
import type { CodingAgentClock } from "../app/coding-agent.members.ts";
import type { CodingAgentSessionReadService } from "./coding-agent-session-read.service.ts";

export const PULL_REQUEST_MAPPING_BACKFILL_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const PULL_REQUEST_MAPPING_BACKFILL_BRANCH_CAP = 500;
export const PULL_REQUEST_MAPPING_BACKFILL_SESSIONS_PER_PROJECT = 500;
export const PULL_REQUEST_MAPPING_BACKFILL_CONCURRENCY = 5;

const logger = createLogger("langwatch:coding-agent:backfill");

/**
 * The one read the backfill makes: a project's recent sessions in a window.
 * Named as its own surface so a caller composes what the backfill uses rather
 * than the whole session-read graph.
 */
export type CodingAgentSessionReads = Pick<CodingAgentSessionReadService, "listRecent">;

/**
 * The one project read the backfill makes, and the one field it reads back.
 * `ProjectApi` satisfies it; stating it this narrowly is what lets a
 * caller compose the backfill without the whole project graph.
 */
export type CodingAgentBackfillProjects = {
  listByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<{ data: ReadonlyArray<{ id: string }> }>;
};

/** Private installation follow-up that discovers Coding Agent's own session branches. */
export class CodingAgentPullRequestMappingBackfillService {
  static create(options: {
    sessionReads: CodingAgentSessionReads;
    github: GithubApi;
    projects: CodingAgentBackfillProjects;
    clock: CodingAgentClock;
  }): CodingAgentPullRequestMappingBackfillService {
    return new CodingAgentPullRequestMappingBackfillService(options);
  }

  private constructor(
    private readonly dependencies: {
      sessionReads: CodingAgentSessionReads;
      github: GithubApi;
      projects: CodingAgentBackfillProjects;
      clock: CodingAgentClock;
    },
  ) {}

  async backfill(input: CodingAgentPullRequestMappingBackfillInput): Promise<void> {
    const parsed = codingAgentPullRequestMappingBackfillInputSchema.parse(input);
    const toMs = this.dependencies.clock.nowMs();
    const projectIds = (
      await this.dependencies.projects.listByOrganization({
        organizationId: parsed.organizationId,
        page: 1,
        limit: PULL_REQUEST_MAPPING_BACKFILL_BRANCH_CAP,
      })
    ).data.map((project) => project.id);
    const targets = new Map<string, PullRequestMappingTarget>();
    for (const projectId of projectIds) {
      if (targets.size >= PULL_REQUEST_MAPPING_BACKFILL_BRANCH_CAP) {
        break;
      }

      const sessions = await this.readProjectSessions({
        organizationId: parsed.organizationId,
        projectId,
        fromMs: toMs - PULL_REQUEST_MAPPING_BACKFILL_WINDOW_MS,
        toMs,
      });
      this.collectTargets({ projectId, sessions, targets });
    }

    await this.requestTargets(targets);
  }

  private async readProjectSessions(input: {
    organizationId: string;
    projectId: string;
    fromMs: number;
    toMs: number;
  }): Promise<CodingAgentSession[]> {
    try {
      return await this.dependencies.sessionReads.listRecent({
        projectId: input.projectId,
        fromMs: input.fromMs,
        toMs: input.toMs,
        limit: PULL_REQUEST_MAPPING_BACKFILL_SESSIONS_PER_PROJECT,
      });
    } catch (error) {
      logger.warn(
        { error, organizationId: input.organizationId, projectId: input.projectId },
        "backfill could not read a project's sessions",
      );

      return [];
    }
  }

  private collectTargets(input: {
    projectId: string;
    sessions: CodingAgentSession[];
    targets: Map<string, PullRequestMappingTarget>;
  }): void {
    for (const session of input.sessions) {
      if (input.targets.size >= PULL_REQUEST_MAPPING_BACKFILL_BRANCH_CAP) {
        break;
      }

      if (!session.repositoryOwner || !session.repositoryName || !session.gitBranch) {
        continue;
      }

      const repositoryHost = this.dependencies.github.normalizeRepositoryHost(
        session.repositoryHost,
      );
      if (!this.dependencies.github.canMapRepositoryHost(repositoryHost)) {
        continue;
      }

      const target = {
        tenantId: input.projectId,
        repositoryHost,
        repositoryOwner: session.repositoryOwner,
        repositoryName: session.repositoryName,
        headBranch: session.gitBranch,
      };
      const key = [
        target.repositoryHost,
        target.repositoryOwner.toLowerCase(),
        target.repositoryName.toLowerCase(),
        target.headBranch,
      ].join("\0");
      if (!input.targets.has(key)) {
        input.targets.set(key, target);
      }
    }
  }

  private async requestTargets(
    targets: ReadonlyMap<string, PullRequestMappingTarget>,
  ): Promise<void> {
    const values = [...targets.values()];
    for (let index = 0; index < values.length; index += PULL_REQUEST_MAPPING_BACKFILL_CONCURRENCY) {
      await Promise.all(
        values.slice(index, index + PULL_REQUEST_MAPPING_BACKFILL_CONCURRENCY).map((target) =>
          this.dependencies.github.requestBranchMapping(target).catch((error: unknown) => {
            logger.warn({ error, ...target }, "backfill could not map a branch");
          }),
        ),
      );
    }
  }
}

type PullRequestMappingTarget = {
  tenantId: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  headBranch: string;
};
