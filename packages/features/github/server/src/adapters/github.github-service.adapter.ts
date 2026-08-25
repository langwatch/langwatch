import type { GithubService } from "@langwatch/github-contract";
import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GithubNonceRedis } from "./github.github-install-nonce.adapter";
import { GithubAppTokenService, type RedisLike } from "./github.github-app-token.adapter";
import type { GithubHostConfig } from "./github.github-host.adapter";
import { GithubInstallationsService } from "../services/github-installations.service";
import { GithubPullRequestMappingService } from "../services/github-pull-request-mapping.service";
import { GithubPullRequestStatusService } from "../services/github-pull-request-status.service";
import { PrismaGithubInstallationsRepository } from "../repositories/prisma/prisma.github-installations.repository";
import { PrismaGithubPullRequestsRepository } from "../repositories/prisma/prisma.github-pull-requests.repository";
import { GithubFeatureService } from "../services/github.service";

type GithubCompositionOptions = {
  database: PrismaClient;
  config: {
    appId: string;
    privateKey: string;
    appSlug: string;
    webhookSecret: string;
    signingKey: string;
  };
  redis: (RedisLike & GithubNonceRedis) | null;
  hostConfig?: GithubHostConfig;
  organization: OrganizationService;
  project: ProjectService;
  codingAgent: CodingAgentService;
};

/** The sole process-composition entry point for the GitHub feature. */
export class GithubCompositionAdapter {
  private constructor() {}

  static create(options: GithubCompositionOptions): GithubService {
    const appTokens = GithubAppTokenService.create(
      options.config.appId,
      options.config.privateKey,
      options.redis,
      options.hostConfig,
    );
    const installationsRepository = PrismaGithubInstallationsRepository.create(
      options.database,
    );
    const pullRequestsRepository = PrismaGithubPullRequestsRepository.create(
      options.database,
    );
    let mapping: GithubPullRequestMappingService | null = null;
    const installations = GithubInstallationsService.create(
      installationsRepository,
      appTokens,
      options.organization,
      ({ organizationId }) => mapping?.runBackfillForOrganization({ organizationId }),
    );
    const mappingService = GithubPullRequestMappingService.create({
      repository: pullRequestsRepository,
      installations,
      appTokens,
      project: options.project,
      codingAgent: options.codingAgent,
      hostConfig: options.hostConfig,
    });
    mapping = mappingService;
    const status = GithubPullRequestStatusService.create({
      repository: pullRequestsRepository,
      installations,
      appTokens,
      redis: options.redis,
    });
    return GithubFeatureService.create({
      installations,
      mapping: mappingService,
      status,
      protocol: {
        ...options.config,
        hostConfig: options.hostConfig ?? {},
        redis: options.redis,
      },
    });
  }
}
