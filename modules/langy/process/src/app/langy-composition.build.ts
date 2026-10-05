/**
 * LangyModule infrastructure: built from its registry rows, config and own classes. The model
 * and session-key members arrive built over peers; commands are supplied
 * externally (taken as dependency tokens).
 */
import { renderLangyTurnContext, type LangyServerConfig } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import { type LangyWorker } from "../channels/langy-worker.channel.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import { RedisLangyTurnRelayRepository } from "../repositories/redis/redis.langy-turn-relay.repository.ts";
import { langyWorkerRuntimeOf } from "../rules/langy-worker-runtime.rules.ts";
import { LangyBlockMetricsOtelService } from "../services/langy-block-metrics-otel.service.ts";
import type {
  LangyGithubService,
  LangyVirtualKeyService,
} from "../services/langy-credential.service.ts";
import {
  LangyGithubPrQuotaService,
  LANGY_GITHUB_PRS_PER_DAY,
} from "../services/langy-github-pr-quota.service.ts";
import type { LangyModel } from "../services/langy-model.service.ts";
import type { LangyNavigateFallbackService } from "../services/langy-navigate-fallback.service.ts";
import type {
  LangyCredentialComposition,
  LangyServiceCompositionOptions,
} from "../services/langy-postgres.service.ts";
import type { LangySessionKeyService } from "../services/langy-session-key.service.ts";
import type { LangySkillGates } from "../services/langy-skill-gates.service.ts";
import type { LangyTurnTechnicalMembers } from "../services/langy-turn-shared.service.ts";
import { LangyGithubPermit } from "../services/langy-turn-shared.service.ts";
import type { LangyUiActionSurface } from "../services/langy-ui-action-surface.service.ts";
import type { OpenLangyRelay } from "../services/langy.service.ts";

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
  /** A turn's GitHub token; absent where no GitHub peer is composed. */
  github?: LangyGithubService;
}): LangyBuiltInfrastructure {
  const { repositories, worker, models, sessionKeys, virtualKeys } = input;

  const permits = LangyGithubPrPermitsAdapter.create(
    LangyGithubPrQuotaService.create({ counts: repositories.githubPrCounts }),
  );

  const turns: LangyTurnTechnicalMembers = {
    models,
    worker,
    tokenBuffer: repositories.tokenBuffer.open(),
    permits,
    perDayPrCap: LANGY_GITHUB_PRS_PER_DAY,
    sessionKeys,
    // The one turn port that answers for real here: rendering the composer's
    // context chips is pure, and the contract package owns it.
    context: { render: renderLangyTurnContext },
    // Without a surface the channel stays closed: advertising one a dispatch
    // cannot reach would be a lie.
    uiActionSurface: input.uiActionSurface ?? { resolve: () => Promise.resolve(false) },
    skillGates: input.skillGates ?? { resolveDisabled: () => Promise.resolve([]) },
    metrics: { count: () => undefined },
    accessStore: repositories.turnAccess,
    handoffStore: repositories.turnHandoff,
  };

  const credentials: LangyCredentialComposition = {
    sessionKeys,
    virtualKeys,
    github: input.github ?? { enabled: false, findTurnTokens: () => Promise.resolve([]) },
    runtime: langyWorkerRuntimeOf({ config: input.config, publicBaseUrl: input.publicBaseUrl }),
  };

  return {
    turns,
    credentials,
    events: null,
    blockMetrics: LangyBlockMetricsOtelService.create(),
    feedbackPrompts: repositories.feedbackPrompts,
    openRelay: relayOpener({
      repositories,
      baseHost: input.publicBaseUrl ?? "",
      navigateFallback: input.navigateFallback,
    }),
  };
}

const relayLogger = createLogger("langwatch:langy:relay");

/**
 * One relay per pushed connection, as main's relay route built it: frames are
 * authenticated against the project-scoped handoff, deduplicated on the turn's
 * nonce set, fanned to the live buffer; an unremembered navigate falls back.
 */
function relayOpener(input: {
  repositories: LangyRepositories;
  baseHost: string;
  navigateFallback: LangyNavigateFallbackService;
}): OpenLangyRelay {
  const { repositories, baseHost, navigateFallback } = input;
  return (conversations) =>
    RedisLangyTurnRelayRepository.create({
      conversations,
      buffer: repositories.tokenBuffer.open(),
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
