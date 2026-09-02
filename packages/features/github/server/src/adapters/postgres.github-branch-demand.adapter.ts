import { GithubBranchDemandPort } from "../ports/github-branch-demand.port";
import type { GithubHostPort } from "../ports/github-host.port";
import type { GithubProjectActivityPort } from "../ports/github-project-activity.port";
import {
  PrismaGithubInstallationsRepository,
  type PrismaGithubInstallationsDatabase,
} from "../repositories/prisma/github-installations.repository";
import {
  PrismaGithubPullRequestsRepository,
  type PrismaGithubPullRequestsDatabase,
} from "../repositories/prisma/github-pull-requests.repository";
import {
  GithubBranchDemandService,
  type BranchMappingRequest,
} from "../services/github-branch-demand.service";
import { GithubBranchMappingService } from "../services/github-branch-mapping.service";
import { GithubInstallationAccessService } from "../services/github-installation-access.service";
import { GithubAppTokenAdapter } from "./github-app-token.adapter";
import { GithubHostAdapter } from "./github-host.adapter";
import { RedisGithubAdapter } from "./redis.github.adapter";

/** The two models branch demand reads, and nothing else in the client. */
export type GithubBranchDemandDatabase = PrismaGithubInstallationsDatabase &
  PrismaGithubPullRequestsDatabase;

export type PostgresGithubBranchDemandOptions = {
  database: GithubBranchDemandDatabase;
  /**
   * The GitHub App this instance is, if it is one.
   *
   * Empty credentials compose a demand path that asks GitHub nothing: the
   * mapping call resolves no installation and maps zero pull requests, which
   * is the same degradation the sweep already declares by name at boot.
   */
  config: { appId: string; privateKey: string };
  /** The process Redis, for the installation-token cache. */
  redis?: object | null;
  hostConfig?: { host?: string };
  /**
   * The organization read and the activity stamp, as the two project facts
   * demand needs. `ProjectService` satisfies it, and so does the narrow
   * Postgres seam a worker composes from its own client.
   */
  project: GithubProjectActivityPort;
};

/**
 * Postgres composition for the demand half of pull-request linkage.
 *
 * The sweep's adapter next door composes the same four objects, and that
 * repetition is deliberate rather than an omission: the two halves take
 * different inputs — demand needs a project seam and the sweep must be
 * composable without one, which is the whole point of their separation — and
 * both may be mounted, one, or neither. Nothing is shared across the two that
 * would be wrong to build twice: the installation-token cache lives in Redis
 * under one keyspace, so two graphs in one process read and write the same
 * cached token rather than minting two.
 *
 * `PostgresGithubAdapter` composes these services as well, alongside the
 * transports' collaborators, an organization service and a full project
 * service; a worker holds none of those and does not need to.
 */
export class PostgresGithubBranchDemandAdapter {
  static create(
    options: PostgresGithubBranchDemandOptions,
  ): PostgresGithubBranchDemandAdapter {
    return new PostgresGithubBranchDemandAdapter(options);
  }

  private constructor(private readonly options: PostgresGithubBranchDemandOptions) {}

  build(): GithubBranchDemandPort {
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

    return ComposedGithubBranchDemand.create({
      demand: GithubBranchDemandService.create({
        mapping: GithubBranchMappingService.create({
          repository: pullRequests,
          installations,
          appTokens,
          host,
        }),
        project: this.options.project,
        host,
      }),
      host,
    });
  }
}

/**
 * The demand service under the two names its cross-feature consumers know.
 *
 * `GithubService` answers the host question from the same `GithubHostPort`
 * this composition resolved, and routes the request into the same demand
 * service, so a consumer holding either object gets the same two answers.
 */
class ComposedGithubBranchDemand extends GithubBranchDemandPort {
  static create(parts: {
    demand: GithubBranchDemandService;
    host: GithubHostPort;
  }): ComposedGithubBranchDemand {
    return new ComposedGithubBranchDemand(parts.demand, parts.host);
  }

  private constructor(
    private readonly demand: GithubBranchDemandService,
    private readonly host: GithubHostPort,
  ) {
    super();
  }

  canMapRepositoryHost(repositoryHost: string): boolean {
    return this.host.isMappable(repositoryHost);
  }

  requestBranchMapping(input: BranchMappingRequest): Promise<void> {
    return this.demand.request(input);
  }
}
