import type { GithubService } from "@langwatch/github-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";

import {
  PrismaGithubInstallationsRepository,
  type PrismaGithubInstallationsDatabase,
} from "../repositories/prisma/github-installations.repository.ts";
import {
  PrismaGithubPullRequestsRepository,
  type PrismaGithubPullRequestsDatabase,
} from "../repositories/prisma/github-pull-requests.repository.ts";
import { GithubInstallationsService } from "../services/github-installations.service.ts";
import { GithubInstallationAccessService } from "../services/github-installation-access.service.ts";
import { GithubBranchDemandService } from "../services/github-branch-demand.service.ts";
import { GithubBranchMaintenanceService } from "../services/github-branch-maintenance.service.ts";
import { GithubBranchMappingService } from "../services/github-branch-mapping.service.ts";
import { GithubPullRequestMappingService } from "../services/github-pull-request-mapping.service.ts";
import { GithubPullRequestStatusService } from "../services/github-pull-request-status.service.ts";
import { GithubPullRequestStatusCacheService } from "../services/github-pull-request-status-cache.service.ts";
import { GithubFeatureService } from "../services/github.service.ts";
import { GithubAppTokenAdapter } from "./github-app-token.adapter.ts";
import { GithubHostAdapter } from "./github-host.adapter.ts";
import { GithubInstallResponseAdapter } from "./github-install-response.adapter.ts";
import { GithubInstallStateAdapter } from "./github-install-state.adapter.ts";
import { GithubPullRequestEventAdapter } from "./github-pull-request-event.adapter.ts";
import { RedisGithubAdapter } from "./redis.github.adapter.ts";

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
