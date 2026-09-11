import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { featureFlagServer } from "@langwatch/feature-flag-server";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { WorkerFeatureFlagCache } from "./worker-feature-flag-cache.ts";

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

/**
 * The kill switches and rollout rules this process reads.
 *
 * WHY REDIS IS OPTIONAL AND THE ABSENCE IS NOT A REFUSAL. Every flag has a
 * stored row; the cache only decides how often it is re-read. A process
 * without Redis falls back to the app's own in-memory tier and answers the
 * same values a little more often from Postgres, which is what the interactive
 * process does when Redis is down. That is different from the mail capability,
 * where an absent variable would have produced mail nobody could act on.
 *
 * WHY ONE PER PROCESS. The app holds a per-process cache tier whose value
 * depends on being shared by every caller in the process. Two of these would
 * halve the hit rate and let two callers disagree for a TTL about whether a
 * kill switch is thrown.
 *
 * WHY IT INSTALLS AFTER THE FOUNDATION. A tenant-targeted read is authorized
 * against the project and organization directories the foundation boots, and
 * the foundation is composed over the Eventing runtime whose kill switch reads
 * this app. The root hands the switch a reference and binds it here.
 */
export async function installWorkerFeatureFlags(options: {
  prisma: PrismaClient;
  config: WorkerConfig;
  redis?: WorkerFeatureFlagRedis | null;
  peers: WorkerFeatureFlagPeers;
}): Promise<FeatureFlagApi> {
  const runtime = await createApp({ role: "api", config: {} })
    .withProvided(AuthzApi, options.peers.permissions)
    .withProvided(ProjectApi, options.peers.projects)
    .withProvided(OrganizationApi, options.peers.organizations)
    .withModules([withMemoryRepositories(featureFlagServer)])
    .boot();

  return runtime.module(featureFlagServer).provided;
}
