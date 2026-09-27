/**
 * LangyApp infrastructure: built from redis, config and own classes. The model
 * and session-key members arrive built over peers; commands are supplied
 * externally (taken as dependency tokens).
 */
import { renderLangyTurnContext, type LangyServerConfig } from "@langwatch/langy-contract";
import type { RedisConnection } from "@langwatch/redis-client";

import { type LangyWorker } from "../channels/langy-worker.channel.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import { LangyTokenBufferRedisRepository } from "../repositories/redis/redis.langy-token-buffer.repository.ts";
import { langyWorkerRuntimeOf } from "../rules/langy-worker-runtime.rules.ts";
import { LangyBlockMetricsOtelService } from "../services/langy-block-metrics-otel.service.ts";
import type { LangyVirtualKeyService } from "../services/langy-credential.service.ts";
import {
  LangyGithubPrQuotaService,
  LANGY_GITHUB_PRS_PER_DAY,
} from "../services/langy-github-pr-quota.service.ts";
import type {
  LangyCredentialComposition,
  LangyServiceCompositionOptions,
} from "../services/langy-postgres.service.ts";
import type { LangySessionKeyService } from "../services/langy-session-key.service.ts";
import type { LangyTurnTechnicalMembers } from "../services/langy-turn-shared.service.ts";
import { LangyGithubPermit, type LangyModel, type LangyUiActionSurface } from "./langy.members.ts";

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
  virtualKeys: LangyVirtualKeyService;
  /** Whether a turn may advertise the page channel; absent holds it closed. */
  uiActionSurface?: LangyUiActionSurface;
}): LangyBuiltInfrastructure {
  const { redis, repositories, worker, models, sessionKeys, virtualKeys } = input;

  const permits = LangyGithubPrPermitsAdapter.create(
    LangyGithubPrQuotaService.create({
      counts: redis ? repositories.githubPrCounts : null,
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
    // Without a surface, or without the Redis the channel runs on, the channel
    // stays closed: advertising one a dispatch cannot reach would be a lie.
    uiActionSurface:
      redis && input.uiActionSurface
        ? input.uiActionSurface
        : { resolve: () => Promise.resolve(false) },
    metrics: { count: () => undefined },
    accessStore: repositories.turnAccess,
    handoffStore: repositories.turnHandoff,
  };

  const credentials: LangyCredentialComposition = {
    sessionKeys,
    virtualKeys,
    github: { enabled: false, mintTurnToken: () => Promise.resolve(null) },
    runtime: langyWorkerRuntimeOf({ config: input.config, publicBaseUrl: input.publicBaseUrl }),
  };

  return {
    turns,
    credentials,
    events: null,
    blockMetrics: LangyBlockMetricsOtelService.create(),
    ...(redis ? { feedbackPrompts: repositories.feedbackPrompts } : {}),
    // No relay: opening one needs this process's public origin, which is not
    // among the two members `LangyApp` reads. A process that serves the
    // relay wires it in later, over this same build.
  };
}
