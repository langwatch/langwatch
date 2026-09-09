import type { GithubService } from "@langwatch/github-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import { composeGithubApi } from "../app/github.app.ts";
import {
  PrismaGithubInstallationsRepository,
  type PrismaGithubInstallationsDatabase,
} from "../repositories/prisma/prisma.github-installations.repository.ts";
import {
  PrismaGithubPullRequestsRepository,
  type PrismaGithubPullRequestsDatabase,
} from "../repositories/prisma/prisma.github-pull-requests.repository.ts";
import type { GithubRedisConnection } from "./redis.github.adapter.ts";

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
  redis: GithubRedisConnection | null;
  hostConfig?: { host?: string };
  organization: OrganizationApi;
  project: ProjectApi;
};

/**
 * The GitHub capability over a process's own Prisma client, for the two roots
 * that still hand one over instead of installing the module. The graph itself
 * is the app's; this only chooses the Postgres rows it runs on.
 */
export class PostgresGithubAdapter {
  private constructor() {}

  static create(options: PostgresGithubAdapterOptions): GithubService {
    return composeGithubApi({
      repositories: {
        installations: PrismaGithubInstallationsRepository.create(options.database),
        pullRequests: PrismaGithubPullRequestsRepository.create(options.database),
      },
      redis: options.redis,
      organization: options.organization,
      project: options.project,
      config: options.config,
      ...(options.hostConfig === undefined ? {} : { hostConfig: options.hostConfig }),
    });
  }
}
