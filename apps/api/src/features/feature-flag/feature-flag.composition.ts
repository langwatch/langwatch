/**
 * The deployment's rollout flags, installed once for the whole process:
 * before every feature that gates on a flag, and after the three directories
 * a tenant-targeted read is authorized against.
 */
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import type { FeatureFlagConfig } from "@langwatch/feature-flag-contract";
import {
  featureFlagServer,
  type FeatureFlagCache,
  type FeatureFlagCacheSlot,
} from "@langwatch/feature-flag-server";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";

import { createFeatureFlagTrpcRouter } from "./feature-flag-trpc.mount.ts";
import type { ComposedFeatureFlagFeature } from "./feature-flag.composition.types.ts";

/** The directories a tenant-targeted flag read is authorized against. */
export type FeatureFlagPeers = Readonly<{
  permissions: AuthzApiContract;
  projects: ProjectApiContract;
  organizations: OrganizationApiContract;
}>;

/** Installs the rollout flags over this process's own connection. */
export async function installApiFeatureFlag(options: {
  prisma: PrismaClient;
  /** This deployment's environment overrides, as the app reads them. */
  config: FeatureFlagConfig;
  peers: FeatureFlagPeers;
}): Promise<ComposedFeatureFlagFeature> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.prisma })
    .withInfrastructure({})
    .withProvided(AuthzApi, options.peers.permissions)
    .withProvided(ProjectApi, options.peers.projects)
    .withProvided(OrganizationApi, options.peers.organizations)
    .withModule(featureFlagServer, {
      infrastructure: {
        cache: new UncachedApiFeatureFlags(),
        config: options.config,
      },
    })
    .boot({ role: "api" });

  return {
    app: runtime.module(featureFlagServer).provided,
    router: (mount) => createFeatureFlagTrpcRouter(mount.runtime),
  };
}

/**
 * The flag cache, absent. Every read goes to Postgres, behind the app's own
 * five-second per-process window.
 */
class UncachedApiFeatureFlags implements FeatureFlagCache {
  findSlot(_key: string): Promise<FeatureFlagCacheSlot | undefined> {
    return Promise.resolve(undefined);
  }

  set(_key: string, _slot: FeatureFlagCacheSlot): Promise<void> {
    return Promise.resolve();
  }

  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }
}
