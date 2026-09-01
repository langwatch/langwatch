import type { GithubBranchMaintenancePort } from "../ports/github-branch-maintenance.port";
import {
  PrismaGithubInstallationsRepository,
  type PrismaGithubInstallationsDatabase,
} from "../repositories/prisma/github-installations.repository";
import {
  PrismaGithubPullRequestsRepository,
  type PrismaGithubPullRequestsDatabase,
} from "../repositories/prisma/github-pull-requests.repository";
import { GithubBranchMaintenanceService } from "../services/github-branch-maintenance.service";
import { GithubBranchMappingService } from "../services/github-branch-mapping.service";
import { GithubInstallationAccessService } from "../services/github-installation-access.service";
import { GithubAppTokenAdapter } from "./github-app-token.adapter";
import { GithubHostAdapter } from "./github-host.adapter";
import { RedisGithubAdapter } from "./redis.github.adapter";

/** The two models the sweep reads, and nothing else in the client. */
export type GithubBranchMaintenanceDatabase = PrismaGithubInstallationsDatabase &
  PrismaGithubPullRequestsDatabase;

export type PostgresGithubBranchMaintenanceOptions = {
  database: GithubBranchMaintenanceDatabase;
  /**
   * The GitHub App this instance is, if it is one.
   *
   * Empty credentials compose a sweep that asks GitHub nothing: the recheck
   * half resolves no installation and answers zero, and the prune half keeps
   * working, because dropping bookkeeping past the activity horizon is a
   * DELETE over rows this process wrote and needs no App at all.
   */
  config: { appId: string; privateKey: string };
  /** The process Redis, for the installation-token cache. */
  redis?: object | null;
  hostConfig?: { host?: string };
};

/**
 * Postgres composition for the fleet-wide branch sweep.
 *
 * The sweep's whole graph is four objects — the pull-request rows, the
 * installation reads, an App token minter and the host — and this is where a
 * process that wants only the sweep gets them. `PostgresGithubAdapter` composes
 * the same services plus the transports' collaborators, an organization service
 * and a project service; a worker holds none of those and does not need to, now
 * that demand and sweep are two services rather than one.
 */
export class PostgresGithubBranchMaintenanceAdapter {
  static create(
    options: PostgresGithubBranchMaintenanceOptions,
  ): PostgresGithubBranchMaintenanceAdapter {
    return new PostgresGithubBranchMaintenanceAdapter(options);
  }

  private constructor(private readonly options: PostgresGithubBranchMaintenanceOptions) {}

  build(): GithubBranchMaintenancePort {
    const host = GithubHostAdapter.create(this.options.hostConfig);
    const redis = this.options.redis ? RedisGithubAdapter.create(this.options.redis) : null;
    const appTokens = GithubAppTokenAdapter.create(
      this.options.config.appId,
      this.options.config.privateKey,
      redis,
      host,
    );
    const pullRequests = PrismaGithubPullRequestsRepository.create(this.options.database);
    const installations = GithubInstallationAccessService.create(
      PrismaGithubInstallationsRepository.create(this.options.database),
      appTokens,
    );

    return GithubBranchMaintenanceService.create({
      repository: pullRequests,
      mapping: GithubBranchMappingService.create({
        repository: pullRequests,
        installations,
        appTokens,
        host,
      }),
    });
  }
}
