import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { featureFlagServer } from "@langwatch/feature-flag-server";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { createApp, membersFrom } from "@langwatch/runtime-composition";
import type { WorkerConfig } from "../platform/config/worker.config.ts";

/**
 * How this process reaches the shared flag cache.
 *
 * Structural rather than a `RedisConnection`, because it is three commands and
 * the adapter already accepts `null` for a deployment that has no Redis to
 * share.
 */
export type WorkerFeatureFlagRedis = {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

/** The three directories a tenant-targeted flag read is authorized against. */
export type WorkerFeatureFlagPeers = Readonly<{
  permissions: AuthzApiContract;
  projects: ProjectApiContract;
  organizations: OrganizationApiContract;
}>;

// Per-process cache tier for flags; one per process so callers don't disagree
// on kill switches; installs after foundation boots project and org directories
export async function installWorkerFeatureFlags(options: {
  prisma: PrismaClient;
  config: WorkerConfig;
  /**
   * No longer read: `FeatureFlagApp` builds its own uncached row adapter now
   * (see `modules/feature-flag/server/src/app/feature-flag.app.ts`), so a
   * shared Redis tier has nowhere left to plug in. Kept on this options
   * record so `worker-production.composition.ts`, which still allocates one
   * before this function runs, needs no matching change.
   */
  redis?: WorkerFeatureFlagRedis | null;
  peers: WorkerFeatureFlagPeers;
}): Promise<FeatureFlagApi> {
  const runtime = await createApp({
    role: "worker",
    config: { "feature-flag": options.config.featureFlags },
    members: membersFrom({ prisma: options.prisma }),
  })
    .withProvided(AuthzApi, options.peers.permissions)
    .withProvided(ProjectApi, options.peers.projects)
    .withProvided(OrganizationApi, options.peers.organizations)
    .withModules([featureFlagServer])
    .boot();

  return runtime.module(featureFlagServer).provided;
}
