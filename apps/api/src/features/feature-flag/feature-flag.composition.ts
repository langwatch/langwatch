/**
 * The deployment's rollout flags, composed once for the whole process.
 *
 * `featureFlag.*` answers a browser which rollouts an account is inside, and
 * every other surface that gates on one — the Langy panel, the governance
 * console, the LangWatchQL workbench, the gateway menu — asks THIS service.
 *
 * ## Why it is its own composition
 *
 * It used to be built twice: once inside the product-group half, which
 * published it as `ctx.app.featureFlags` and as the record's shared
 * infrastructure, and once inside the analytics half, for the workbench
 * rollout gate and the graph-visibility policy. Both read the same table
 * through the same uncached port, so they agreed — but they were two objects
 * answering one question, which is the shape this codebase refuses everywhere
 * else. A rollout that answers two ways at one instant is worse than one that
 * answers slowly.
 *
 * So the process composes it FIRST, before any feature that gates on a flag,
 * and hands the one instance to all of them.
 */
import type {
  FeatureFlagConfig,
  FeatureFlagService,
} from "@langwatch/feature-flag-contract";
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
 * The flag store on a process with no database.
 *
 * The namespace still mounts and every read refuses by name. It does NOT
 * answer "off": a surface behind a rollout would then render as deliberately
 * disabled, and an operator would look for the flag rather than for the
 * database this process never opened.
 */
export function refusingFeatureFlagFeature(): ComposedFeatureFlagFeature {
  return {
    router: (mount) => createFeatureFlagTrpcRouter(mount),
    service: new Proxy(
      {},
      {
        get:
          () =>
          (): never => {
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
 * The flag cache, absent.
 *
 * Every read goes to Postgres. That is the correct default for a process with
 * no shared cache rather than a degradation: a cached flag on one process and
 * an uncached one on another is a rollout that answers two different ways at
 * the same instant, which is worse than answering slowly.
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
