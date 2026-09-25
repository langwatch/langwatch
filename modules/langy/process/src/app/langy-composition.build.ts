/**
 * LangyApp infrastructure: built from prisma/redis and own classes. Pieces
 * either stubs or redis-only (no token needed). commands/broadcast supplied
 * externally (taken as dependency tokens).
 */
import {
  renderLangyTurnContext,
  type LangyServerConfig,
  LangyNotEnabledError,
} from "@langwatch/langy-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { Redis } from "ioredis";

import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import { LangyTokenBufferRedisRepository } from "../repositories/redis/redis.langy-token-buffer.repository.ts";
import { LangyBlockMetricsOtelService } from "../services/langy-block-metrics-otel.service.ts";
import {
  LangyGithubPrCounter,
  LangyGithubPrQuotaService,
  LANGY_GITHUB_PRS_PER_DAY,
} from "../services/langy-github-pr-quota.service.ts";
import type {
  LangyCredentialComposition,
  LangyServiceCompositionOptions,
} from "../services/langy-postgres.service.ts";
import type { LangyTurnTechnicalMembers } from "../services/langy-turn-shared.service.ts";
import { LangyGithubPermit, type LangyWorker } from "./langy.members.ts";

/** The Redis surface this file needs: exactly what `LangyGithubPrCounter` names. */
export type LangyGithubPrRedis = Readonly<
  Pick<Redis, "get" | "incr" | "decr" | "incrby" | "expire" | "eval">
>;

/**
 * The daily pull-request counter, on this process's own Redis. `eval` is
 * declared for the quota service's Lua check-and-decrement release;
 * without it a read-then-decr can underflow and grant unlimited permits.
 */
class LangyGithubPrRedisCounter extends LangyGithubPrCounter {
  static create(redis: LangyGithubPrRedis): LangyGithubPrRedisCounter {
    return new LangyGithubPrRedisCounter(redis);
  }

  private constructor(private readonly redis: LangyGithubPrRedis) {
    super();
  }

  tryGet(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  decr(key: string): Promise<number> {
    return this.redis.decr(key);
  }

  incrby(key: string, amount: number): Promise<number> {
    return this.redis.incrby(key, amount);
  }

  expire(key: string, seconds: number): Promise<unknown> {
    return this.redis.expire(key, seconds);
  }

  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown> {
    return this.redis.eval(script, numKeys, ...args);
  }
}

/** The turn's three permit calls, on the feature package's own quota service. */
class LangyGithubPrPermitsAdapter extends LangyGithubPermit {
  static create(quota: LangyGithubPrQuotaService): LangyGithubPrPermitsAdapter {
    return new LangyGithubPrPermitsAdapter(quota);
  }

  private constructor(private readonly quota: LangyGithubPrQuotaService) {
    super();
  }

  reserve(input: { userId: string }): Promise<{
    reserved: boolean;
    allowed: boolean;
    resetAt: number;
  }> {
    return this.quota.reservePermit(input);
  }

  release(input: { userId: string }): Promise<void> {
    return this.quota.releasePermit(input);
  }

  check(input: { userId: string }): Promise<{ allowed: boolean }> {
    return this.quota.usage(input);
  }
}

/**
 * Everything `PostgresLangyAdapter.build` needs besides `commands`: the turn
 * technical members, the credential stubs, and the process's own optional
 * collaborators (events reader, block metrics, the feedback-prompt store).
 */
export type LangyBuiltInfrastructure = Omit<LangyServiceCompositionOptions, "commands">;

export function buildLangyInfrastructure(input: {
  redis: RedisConnection | null;
  config: LangyServerConfig;
  worker: LangyWorker;
  repositories: LangyRepositories;
}): LangyBuiltInfrastructure {
  const { redis, repositories, worker } = input;

  const permits = LangyGithubPrPermitsAdapter.create(
    LangyGithubPrQuotaService.create({
      counter: redis ? LangyGithubPrRedisCounter.create(redis) : null,
    }),
  );

  const turns: LangyTurnTechnicalMembers = {
    // Resolving the model a turn runs on refuses rather than inventing one: a
    // guessed model bills a customer's key against a provider they did not
    // choose (matches the deleted composition's own choice).
    models: {
      resolve: () => Promise.reject(new LangyNotEnabledError()),
    },
    worker,
    tokenBuffer: redis ? LangyTokenBufferRedisRepository.create({ redis }) : null,
    permits,
    perDayPrCap: LANGY_GITHUB_PRS_PER_DAY,
    sessionKeys: {
      mint: () => Promise.reject(new LangyNotEnabledError()),
      revoke: () => Promise.resolve(),
    },
    // The one turn port that answers for real here: rendering the composer's
    // context chips is pure, and the contract package owns it.
    context: { render: renderLangyTurnContext },
    // Fails toward the closed channel: nothing here resolves a project's
    // rollout flag, so advertising the surface would be a lie.
    uiActionSurface: { resolve: () => Promise.resolve(false) },
    metrics: { count: () => undefined },
    accessStore: repositories.turnAccess,
    handoffStore: repositories.turnHandoff,
  };

  const credentials: LangyCredentialComposition = {
    sessionKeys: {
      mint: () => Promise.reject(new LangyNotEnabledError()),
      revokeManaged: () => Promise.resolve("refused" as const),
    },
    virtualKeys: {
      provision: () => Promise.reject(new LangyNotEnabledError()),
    },
    github: { enabled: false, mintTurnToken: () => Promise.resolve(null) },
    runtime: {
      workerCallbackUrl: undefined,
      workerGatewayBaseUrl: undefined,
      mirrorProjectId: undefined,
    },
  };

  return {
    turns,
    credentials,
    events: null,
    blockMetrics: LangyBlockMetricsOtelService.create(),
    ...(redis ? { feedbackPromptRedis: redis } : {}),
    // No relay: opening one needs this process's public origin, which is not
    // among the two members `LangyApp` reads. A process that serves the
    // relay wires it in later, over this same build.
  };
}
