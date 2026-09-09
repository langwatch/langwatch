/**
 * The Postgres bundle. Hand-written rather than `prismaRepositories(...)`
 * because the pull-request repository's atomic claim and its retention delete
 * are raw statements, which the declared-delegate client does not carry.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { GithubRepositories } from "../github.repositories.ts";
import { PrismaGithubInstallationsRepository } from "./prisma.github-installations.repository.ts";
import { PrismaGithubPullRequestsRepository } from "./prisma.github-pull-requests.repository.ts";

export class PostgresGithubRepositories {
  static readonly requires = ["prisma"] as const;

  static create(infrastructure: Readonly<{ prisma: PrismaClient }>): GithubRepositories {
    return {
      installations: PrismaGithubInstallationsRepository.create(infrastructure.prisma),
      pullRequests: PrismaGithubPullRequestsRepository.create(infrastructure.prisma),
    };
  }
}
