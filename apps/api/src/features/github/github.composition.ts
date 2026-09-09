/**
 * `github.*`, composed as its own feature rather than as a member of a group. The GitHub
 * App an organization connected, the repositories it reaches and the pull requests its
 * coding agents opened.
 */
import type { GithubApi } from "@langwatch/github-contract";
import {
  githubServer,
  githubTrpcTransport,
  type GithubInfrastructure,
} from "@langwatch/github-server";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { createLogger } from "@langwatch/observability";

import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";

const logger = createLogger("langwatch:api:github");

/** The `ctx.app.github` slice every GitHub door on this process reads. */
export type ComposedGithubFeature = Readonly<{ app: GithubApi }>;

/** The directories the connection reads: who is in an organization, and whose project this is. */
export type GithubPeers = Readonly<{
  organizations: OrganizationApiContract;
  projects: ProjectApiContract;
}>;

/** The GitHub App this deployment registered, as configuration states it. */
export type GithubAppRegistration = Readonly<{
  appId?: string | undefined;
  host?: string | undefined;
  privateKey?: string | undefined;
  appSlug?: string | undefined;
  webhookSecret?: string | undefined;
}>;

/** Installs the GitHub connection over this process's own graph. */
export async function installApiGithub(options: {
  /** The one guarded connection every installation and pull-request row is read on. */
  prisma: PrismaClient;
  peers: GithubPeers;
  /**
   * The Redis the installation-token cache and the install-state nonce run on.
   * `null` on a process that opened none: both degrade to asking GitHub every
   * time, which is what the module already does without one.
   */
  redis: GithubInfrastructure["redis"];
  config: GithubAppRegistration;
  /**
   * The same key every other stored credential on this deployment is sealed
   * with: an install state signed by one process and verified by another has to
   * be the same signature.
   */
  signingKey: string;
}): Promise<ComposedGithubFeature> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.prisma })
    .withInfrastructure({})
    .withProvided(OrganizationApi, options.peers.organizations)
    .withProvided(ProjectApi, options.peers.projects)
    .withModule(githubServer, {
      infrastructure: { redis: options.redis, signingKey: options.signingKey },
    })
    .boot({ role: "api", config: { github: options.config } });

  return { app: runtime.module(githubServer).provided };
}

/** Builds `github.*` on this process's root, over this process's own graph. */
export function composeGithubTrpcRouter(options: {
  mount: ApiTrpcFeatureMount;
  infrastructure: ApiTrpcInfrastructure;
}) {
  const { infrastructure } = options;

  return options.mount.runtime.mount(githubTrpcTransport, (ctx) => ({
    github: (): GithubApi => ctx.app.github,
    // The organization is derived from the project through the coding-agent
    // directory, which is the one application that already answers it, so the
    // live pull-request read and its linkage cannot disagree about the tenant.
    findOrganizationForProject: (projectId) =>
      ctx.app.codingAgentApp.findOrganizationForProject(projectId),
    recordAudit: async (entry) => {
      await infrastructure.audit?.record({
        actorId: entry.userId,
        path: entry.action,
        input: { organizationId: entry.organizationId, ...entry.args },
        error: null,
      });
      logger.debug({ action: entry.action }, "recorded a GitHub connection command");
    },
  }));
}
