/**
 * A project's scoped privacy rules, composed as its own feature. `dataPrivacy.*` — the
 * snapshot the settings screen renders, and the two writes that set and clear a rule at a
 * scope.
 */
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import {
  dataPrivacyServer,
  PrismaDataPrivacyDirectoryRepository,
} from "@langwatch/data-privacy-server";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createDataPrivacyTrpcRouter } from "./data-privacy-trpc.mount.ts";
import type { ComposedDataPrivacyFeature } from "./data-privacy.composition.types.ts";

/** The other features' apps the privacy cascade is resolved and authorized through. */
export type DataPrivacyPeers = Readonly<{
  /** Resolves a project's organization, team and department. */
  projects: ProjectApiContract;
  /** Resolves a team's organization, for a TEAM-scoped rule. */
  organizations: OrganizationApiContract;
  /** The SAME permission answers the declared check on the same procedure asks. */
  permissions: AuthzApiContract;
}>;

/** Installs the privacy surface over this process's own graph. */
export async function installApiDataPrivacy(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: DataPrivacyPeers;
}): Promise<ComposedDataPrivacyFeature> {
  const { prisma, featureFlags } = options.infrastructure;
  const { projects, organizations, permissions } = options.peers;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(ProjectApi, projects)
    .withProvided(OrganizationApi, organizations)
    .withProvided(AuthzApi, permissions)
    .withProvided(FeatureFlagApi, featureFlags)
    .withModule(dataPrivacyServer, {
      infrastructure: {
        directory: PrismaDataPrivacyDirectoryRepository.create(prisma),
        // This process composes no PII analysis transport: the log and metric
        // doors that redact records are installed in the worker, beside one.
        redaction: null,
      },
    })
    .boot({ role: "api" });

  const app = runtime.module(dataPrivacyServer).provided;

  return {
    router: (mount) => createDataPrivacyTrpcRouter(mount.runtime),
    app,
  };
}
