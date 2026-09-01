import type { GithubService } from "@langwatch/github-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";

import {
  PrismaGithubInstallationsRepository,
  type PrismaGithubInstallationsDatabase,
} from "../repositories/prisma/github-installations.repository";
import {
  PrismaGithubPullRequestsRepository,
  type PrismaGithubPullRequestsDatabase,
} from "../repositories/prisma/github-pull-requests.repository";
import { GithubInstallationsService } from "../services/github-installations.service";
import { GithubInstallationAccessService } from "../services/github-installation-access.service";
import { GithubBranchDemandService } from "../services/github-branch-demand.service";
import { GithubBranchMaintenanceService } from "../services/github-branch-maintenance.service";
import { GithubBranchMappingService } from "../services/github-branch-mapping.service";
import { GithubPullRequestMappingService } from "../services/github-pull-request-mapping.service";
import { GithubPullRequestStatusService } from "../services/github-pull-request-status.service";
import { GithubPullRequestStatusCacheService } from "../services/github-pull-request-status-cache.service";
import { GithubFeatureService } from "../services/github.service";
import { GithubAppTokenAdapter } from "./github-app-token.adapter";
import { GithubHostAdapter } from "./github-host.adapter";
import { GithubInstallResponseAdapter } from "./github-install-response.adapter";
import { GithubInstallStateAdapter } from "./github-install-state.adapter";
import { GithubPullRequestEventAdapter } from "./github-pull-request-event.adapter";
import { RedisGithubAdapter } from "./redis.github.adapter";

/** Everything the whole GitHub capability reads through, in one client. */
export type GithubDatabase = PrismaGithubInstallationsDatabase & PrismaGithubPullRequestsDatabase;

type PostgresGithubAdapterOptions = {
  database: GithubDatabase;
  config: {
    appId: string;
    privateKey: string;
    appSlug: string;
    webhookSecret: string;
    signingKey: string;
  };
  redis: object | null;
  hostConfig?: { host?: string };
  organization: OrganizationService;
  project: ProjectService;
};

/** Composes the process-owned GitHub service with its private repositories. */
export class PostgresGithubAdapter {
  private constructor() {}

  static create(options: PostgresGithubAdapterOptions): GithubService {
    const host = GithubHostAdapter.create(options.hostConfig);
    const redis = options.redis ? RedisGithubAdapter.create(options.redis) : null;
    const appTokens = GithubAppTokenAdapter.create(
      options.config.appId,
      options.config.privateKey,
      redis,
      host,
    );
    const installationsRepository = PrismaGithubInstallationsRepository.create(options.database);
    const pullRequestsRepository = PrismaGithubPullRequestsRepository.create(options.database);
    const installationAccess = GithubInstallationAccessService.create(
      installationsRepository,
      appTokens,
    );
    const installations = GithubInstallationsService.create(
      installationsRepository,
      appTokens,
      options.organization,
      installationAccess,
    );
    const branchMapping = GithubBranchMappingService.create({
      repository: pullRequestsRepository,
      installations: installationAccess,
      appTokens,
      host,
    });
    const branchDemand = GithubBranchDemandService.create({
      mapping: branchMapping,
      project: options.project,
      host,
    });
    const branchMaintenance = GithubBranchMaintenanceService.create({
      repository: pullRequestsRepository,
      mapping: branchMapping,
    });
    const mapping = GithubPullRequestMappingService.create({
      repository: pullRequestsRepository,
      branches: branchMapping,
      demand: branchDemand,
      maintenance: branchMaintenance,
    });
    const statusCache = GithubPullRequestStatusCacheService.create(redis);
    const status = GithubPullRequestStatusService.create({
      repository: pullRequestsRepository,
      installations,
      appTokens,
      cache: statusCache,
    });
    const installState = GithubInstallStateAdapter.create({
      signingKey: options.config.signingKey,
      redis,
    });
    const installResponse = GithubInstallResponseAdapter.create();
    const pullRequestEvents = GithubPullRequestEventAdapter.create();

    return GithubFeatureService.create({
      installations,
      mapping,
      status,
      config: {
        appSlug: options.config.appSlug,
        webhookSecret: options.config.webhookSecret,
      },
      host,
      installState,
      installResponse,
      pullRequestEvents,
    });
  }
}
