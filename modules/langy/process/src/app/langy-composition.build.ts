/**
 * LangyModule infrastructure: built from redis, config and own classes. The model
 * and session-key members arrive built over peers; commands are supplied
 * externally (taken as dependency tokens).
 */
import { renderLangyTurnContext, type LangyServerConfig } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

import { type LangyWorker } from "../channels/langy-worker.channel.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import { LangyTokenBufferRedisRepository } from "../repositories/redis/redis.langy-token-buffer.repository.ts";
import { RedisLangyTurnRelayRepository } from "../repositories/redis/redis.langy-turn-relay.repository.ts";
import { langyWorkerRuntimeOf } from "../rules/langy-worker-runtime.rules.ts";
import { LangyBlockMetricsOtelService } from "../services/langy-block-metrics-otel.service.ts";
import type { LangyVirtualKeyService } from "../services/langy-credential.service.ts";
import {
  LangyGithubPrQuotaService,
  LANGY_GITHUB_PRS_PER_DAY,
} from "../services/langy-github-pr-quota.service.ts";
import type { LangyNavigateFallbackService } from "../services/langy-navigate-fallback.service.ts";
import type {
  LangyCredentialComposition,
  LangyServiceCompositionOptions,
} from "../services/langy-postgres.service.ts";
import type { LangySessionKeyService } from "../services/langy-session-key.service.ts";
import type { LangyTurnTechnicalMembers } from "../services/langy-turn-shared.service.ts";
import type { OpenLangyRelay } from "../services/langy.service.ts";
import {
  LangyGithubPermit,
  type LangyModel,
  type LangySkillGates,
  type LangyUiActionSurface,
} from "./langy.members.ts";

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
  worker: LangyWorker | null;
  repositories: LangyRepositories;
  models: LangyModel;
  sessionKeys: LangySessionKeyService;
  virtualKeys: LangyVirtualKeyService;
  /** Whether a turn may advertise the page channel; absent holds it closed. */
  uiActionSurface?: LangyUiActionSurface;
  /** Which gated skills a turn hides; absent hides none. */
  skillGates?: LangySkillGates;
  /** Where a navigate the conversation remembered no link for opens. */
  navigateFallback: LangyNavigateFallbackService;
}): LangyBuiltInfrastructure {
  const { redis, repositories, worker, models, sessionKeys, virtualKeys } = input;
  const tokenBuffer = redis ? LangyTokenBufferRedisRepository.create({ redis }) : null;

  const permits = LangyGithubPrPermitsAdapter.create(
    LangyGithubPrQuotaService.create({
      counts: redis ? repositories.githubPrCounts : null,
    }),
  );

  const turns: LangyTurnTechnicalMembers = {
    models,
    worker,
    tokenBuffer,
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
    skillGates: input.skillGates ?? { resolveDisabled: () => Promise.resolve([]) },
    metrics: { count: () => undefined },
    accessStore: repositories.turnAccess,
    handoffStore: repositories.turnHandoff,
  };

  const credentials: LangyCredentialComposition = {
    sessionKeys,
    virtualKeys,
    github: { enabled: false, findTurnTokens: () => Promise.resolve([]) },
    runtime: langyWorkerRuntimeOf({ config: input.config, publicBaseUrl: input.publicBaseUrl }),
  };

  return {
    turns,
    credentials,
    events: null,
    blockMetrics: LangyBlockMetricsOtelService.create(),
    ...(redis ? { feedbackPrompts: repositories.feedbackPrompts } : {}),
    // No live buffer, no relay: the internal service answers 503 before opening one.
    ...(redis
      ? {
          openRelay: relayOpener({
            redis,
            repositories,
            baseHost: input.publicBaseUrl ?? "",
            navigateFallback: input.navigateFallback,
          }),
        }
      : {}),
  };
}

const relayLogger = createLogger("langwatch:langy:relay");

/**
 * One relay per pushed connection, as main's relay route built it: frames are
 * authenticated against the project-scoped handoff, deduplicated on the turn's
 * nonce set, fanned to the live buffer; an unremembered navigate falls back.
 */
function relayOpener(input: {
  redis: RedisConnection;
  repositories: LangyRepositories;
  baseHost: string;
  navigateFallback: LangyNavigateFallbackService;
}): OpenLangyRelay {
  const { redis, repositories, baseHost, navigateFallback } = input;
  return (conversations) =>
    RedisLangyTurnRelayRepository.create({
      conversations,
      buffer: LangyTokenBufferRedisRepository.create({ redis }),
      frameDedup: repositories.frameDedup,
      handoff: repositories.turnHandoff,
      resourceLinks: repositories.resourceLinks,
      resolveResourceUrl: async (navigate) => {
        const resolution = await navigateFallback.resolveUrl(navigate);
        return resolution.outcome === "resolved" ? resolution.url : null;
      },
      baseHost,
      logger: relayLogger,
    });
}
