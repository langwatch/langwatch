/**
 * The deployment's rollout flags, composed once for the whole process.
 */
import type { FeatureFlagConfig, FeatureFlagService } from "@langwatch/feature-flag-contract";
import {
  FeatureFlagCachePort,
  PostgresFeatureFlagAdapter,
  type FeatureFlagCacheSlot,
} from "@langwatch/feature-flag-server";
import { HandledError } from "@langwatch/handled-error";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ApiTrpcFeatureMount } from "../../api.application";
import { createFeatureFlagTrpcRouter } from "./feature-flag-trpc.mount";

/** The namespace and the one service every other rollout gate reads. */
export type ComposedFeatureFlagFeature = Readonly<{
  /** `featureFlag.*`. Takes no ports: it answers from `ctx.app.featureFlags`. */
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createFeatureFlagTrpcRouter>;
  /** For `ctx.app.featureFlags`, for the shared infrastructure, and for peers. */
  service: FeatureFlagService;
}>;

/** Composes the flag store over this process's own connection. */
export function composeFeatureFlagFeature(options: {
  prisma: PrismaClient;
  /** This deployment's environment overrides, as the service reads them. */
  config: FeatureFlagConfig;
}): ComposedFeatureFlagFeature {
  return {
    router: (mount) => createFeatureFlagTrpcRouter(mount),
    service: PostgresFeatureFlagAdapter.create({
      database: options.prisma,
      cache: new UncachedApiFeatureFlags(),
      config: options.config,
      now: () => Date.now(),
    }),
  };
}

/**
 * The flag store on a process with no database. The namespace still mounts and every read
 * refuses by name.
 */
export function refusingFeatureFlagFeature(): ComposedFeatureFlagFeature {
  return {
    router: (mount) => createFeatureFlagTrpcRouter(mount),
    service: new Proxy(
      {},
      {
        get: () => (): never => {
          throw new ApiFeatureFlagUnavailableError();
        },
        has: () => true,
      },
    ) as FeatureFlagService,
  };
}

/** The rollout store reached on a process that composed none. */
class ApiFeatureFlagUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "This deployment cannot read its rollout flags.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiFeatureFlagUnavailableError";
  }
}

/**
 * The flag cache, absent. Every read goes to Postgres.
 */
class UncachedApiFeatureFlags extends FeatureFlagCachePort {
  tryGet(_key: string): Promise<FeatureFlagCacheSlot | undefined> {
    return Promise.resolve(undefined);
  }

  set(_key: string, _slot: FeatureFlagCacheSlot): Promise<void> {
    return Promise.resolve();
  }

  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }
}
