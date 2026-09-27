/**
 * LangyApp infrastructure: built from redis, config and own classes. The model
 * and session-key members arrive built over peers; commands are supplied
 * externally (taken as dependency tokens).
 */
import {
  renderLangyTurnContext,
  type LangyServerConfig,
  LangyNotEnabledError,
} from "@langwatch/langy-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { Redis } from "ioredis";

import { type LangyWorker } from "../channels/langy-worker.channel.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import { LangyTokenBufferRedisRepository } from "../repositories/redis/redis.langy-token-buffer.repository.ts";
import { langyWorkerRuntimeOf } from "../rules/langy-worker-runtime.rules.ts";
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
import type { LangySessionKeyService } from "../services/langy-session-key.service.ts";
import type { LangyTurnTechnicalMembers } from "../services/langy-turn-shared.service.ts";
import { LangyGithubPermit, type LangyModel } from "./langy.members.ts";

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

  async count(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    return raw ? Number.parseInt(raw, 10) : 0;
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
 * Everything `LangyPostgresService.build` needs besides `commands`: the turn
 * technical members, the credential stubs, and the process's own optional
 * collaborators (events reader, block metrics, the feedback-prompt store).
 */
export type LangyBuiltInfrastructure = Omit<LangyServiceCompositionOptions, "commands">;

export function buildLangyInfrastructure(input: {
  redis: RedisConnection | null;
  config: LangyServerConfig;
  publicBaseUrl: string | undefined;
  worker: LangyWorker;
  repositories: LangyRepositories;
  models: LangyModel;
  sessionKeys: LangySessionKeyService;
}): LangyBuiltInfrastructure {
  const { redis, repositories, worker, models, sessionKeys } = input;

  const permits = LangyGithubPrPermitsAdapter.create(
    LangyGithubPrQuotaService.create({
      counter: redis ? LangyGithubPrRedisCounter.create(redis) : null,
    }),
  );

  const turns: LangyTurnTechnicalMembers = {
    models,
    worker,
    tokenBuffer: redis ? LangyTokenBufferRedisRepository.create({ redis }) : null,
    permits,
    perDayPrCap: LANGY_GITHUB_PRS_PER_DAY,
    sessionKeys,
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
    sessionKeys,
    virtualKeys: {
      provision: () => Promise.reject(new LangyNotEnabledError()),
    },
    github: { enabled: false, mintTurnToken: () => Promise.resolve(null) },
    runtime: langyWorkerRuntimeOf({ config: input.config, publicBaseUrl: input.publicBaseUrl }),
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
