import {
  LangyDispatchRejectedError,
  LangyTurnErrors,
  LangyTurnDispatchRetry,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import { type LangyWorker } from "../../channels/langy-worker.channel.ts";
import type { LangyIntentEffects } from "../../eventing/langy-conversation.intent.ts";
import type { LangyFailTurnCommand } from "../../eventing/langy-conversation.subscriber.ts";
import type { LangyTitleGenerator } from "../../services/langy-title-generator.service.ts";
import type { LangyTurnHandoff } from "../langy-live-turn.repository.ts";
import type { LangyTurnHandoffRedisRepository } from "./redis.langy-turn-handoff.repository.ts";

const logger = createLogger("langwatch:langy:process-effects");

/**
 * Slack the outbox lease MUST keep on top of the slowest in-flight effect: a handoff read plus the
 * transactional commit that retires the message.
 */

export interface CreateLangyEffectRepositoryOptions {
  handoffStore: Pick<LangyTurnHandoffRedisRepository, "read" | "stash" | "isStopped">;
  worker: LangyWorker;
  mintSessionKey: (args: {
    userId: string;
    projectId: string;
    organizationId: string;
  }) => Promise<{ token: string; apiKeyId: string }>;
  revokeSessionKey: (args: { apiKeyId: string; projectId: string }) => Promise<void>;
  /** Terminalizes a permanently rejected turn — same port liveness uses. */
  failTurn: LangyFailTurnCommand;
  /** Client-visible error frame for the stream tail. Best-effort. */
  markError: (params: {
    conversationId: string;
    turnId: string;
    error: ReturnType<typeof LangyTurnErrors.serialize>;
  }) => Promise<void>;
  titleGenerator: LangyTitleGenerator;
  saveTitle: (params: {
    projectId: string;
    conversationId: string;
    turnId: string;
    title: string;
    model: string;
  }) => Promise<void>;
}

function assertHandoffIdentity(params: {
  handoff: LangyTurnHandoff;
  projectId: string;
  conversationId: string;
  turnId: string;
}): void {
  const { handoff, projectId, conversationId, turnId } = params;
  if (
    handoff.projectId !== projectId ||
    handoff.conversationId !== conversationId ||
    handoff.turnId !== turnId
  ) {
    throw new Error(
      `Langy turn handoff identity mismatch for ${projectId}/${conversationId}/${turnId}`,
    );
  }
}

type TurnRef = { projectId: string; conversationId: string; turnId: string };
type DispatchIntent = "create" | "revive" | "continue";

/**
 * One turn's worker dispatch from the process outbox. It peeks rather than consumes the handoff,
 * so an outbox failure can retry the same short-lived handoff until its normal TTL expires.
 */
class LangyTurnDispatchEffect {
  constructor(private readonly deps: CreateLangyEffectRepositoryOptions) {}

  readonly dispatchTurn = async (turn: TurnRef): Promise<void> => {
    const handoff = await this.liveHandoff(turn);
    if (!handoff) return;
    let current = handoff;
    let intent = dispatchIntentOf({
      resumable: Boolean(handoff.resumeToken),
      hasApiKey: Boolean(handoff.credentials.langwatchApiKey),
    });
    let outcome = await this.dispatch({ turn, handoff: current, intent });

    // A probe hit is only a latency hint: the worker may die before this durable effect reaches
    // it. The key is recovered once from the actor and persisted into the retryable handoff.
    if (outcome === "credentialsRequired" && !current.credentials.langwatchApiKey) {
      current = await this.recoverCredentials({ turn, handoff: current });
      intent = current.resumeToken ? "revive" : "create";
      outcome = await this.dispatch({ turn, handoff: current, intent });
    }
    if (outcome === "accepted") return;
    if (outcome === "rejected") return this.terminalize(turn);
    throw new LangyTurnDispatchRetry(
      `langy dispatch not accepted (${outcome}) for turn ${turn.turnId}`,
    );
  };

  /**
   * The handoff to dispatch, or none. Missing/expired is not recoverable by retrying this intent
   * (the heartbeat-aware liveness subscriber terminalizes an abandoned turn), and a turn the user
   * stopped already has its terminal on the record — dispatching would spend a worker for nothing.
   */
  private async liveHandoff(turn: TurnRef): Promise<LangyTurnHandoff | undefined> {
    const { projectId, conversationId, turnId } = turn;
    const lookup = await this.deps.handoffStore.read({ conversationId, turnId });
    if (lookup.kind === "miss") {
      logger.warn(turn, "No Langy turn handoff found; leaving recovery to liveness");
      return undefined;
    }
    assertHandoffIdentity({ handoff: lookup.handoff, projectId, conversationId, turnId });
    if (await this.deps.handoffStore.isStopped({ conversationId, turnId })) {
      logger.info(turn, "langy turn was stopped before dispatch; not starting the work");
      return undefined;
    }
    return lookup.handoff;
  }

  /** The seed rides a re-drive too: a fresh session must still get the conversation so far. */
  private dispatch({
    turn,
    handoff,
    intent,
  }: {
    turn: TurnRef;
    handoff: LangyTurnHandoff;
    intent: DispatchIntent;
  }) {
    return this.deps.worker.dispatch({
      intent,
      ...turn,
      userId: handoff.actorUserId,
      runToken: handoff.runToken,
      prompt: handoff.prompt,
      system: handoff.system,
      ...(handoff.historySeed ? { historySeed: handoff.historySeed } : {}),
      credentials: handoff.credentials,
      ...(handoff.modelOverride ? { modelOverride: handoff.modelOverride } : {}),
      ...(handoff.resumeToken ? { resumeToken: handoff.resumeToken } : {}),
    });
  }

  /**
   * Mints a key for the actor and stashes it into the handoff, so later outbox or liveness
   * deliveries reuse it rather than minting on every retry; a key it cannot stash is revoked.
   */
  private async recoverCredentials({
    turn,
    handoff,
  }: {
    turn: TurnRef;
    handoff: LangyTurnHandoff;
  }): Promise<LangyTurnHandoff> {
    const minted = await this.deps.mintSessionKey({
      userId: handoff.actorUserId,
      projectId: turn.projectId,
      organizationId: handoff.credentials.organizationId,
    });
    const recovered = {
      ...handoff,
      credentials: {
        ...handoff.credentials,
        langwatchApiKey: minted.token,
        langwatchApiKeyId: minted.apiKeyId,
      },
    };
    try {
      await this.deps.handoffStore.stash(recovered);
    } catch (error) {
      await this.deps
        .revokeSessionKey({ apiKeyId: minted.apiKeyId, projectId: turn.projectId })
        .catch((revokeError: unknown) =>
          logger.warn({ revokeError, ...turn }, "failed to revoke unstashed Langy recovery key"),
        );
      throw error;
    }
    return recovered;
  }

  /**
   * A permanent rejection poisons the outbox if it may retry — the agent answers the same 4xx
   * forever and every later turn queues behind it — so the turn is durably failed instead.
   */
  private async terminalize(turn: TurnRef): Promise<void> {
    logger.warn(turn, "langy dispatch permanently rejected; terminalizing the turn");
    const error = LangyTurnErrors.serialize(new LangyDispatchRejectedError());
    const { conversationId, turnId } = turn;
    await this.deps.markError({ conversationId, turnId, error }).catch(() => undefined);
    await this.deps.failTurn.failTurn({ ...turn, error });
  }
}

/**
 * Live effect adapters for process-outbox delivery. The dispatcher owns the consumer span and
 * retry attempt; the worker and title generator own their downstream spans.
 */
export class RedisLangyEffectRepository {
  static create(deps: CreateLangyEffectRepositoryOptions): LangyIntentEffects {
    return {
      workerDispatch: new LangyTurnDispatchEffect(deps),
      titleGeneration: {
        async generateTitle({ projectId, conversationId, turnId }): Promise<void> {
          const generated = await deps.titleGenerator({ projectId, conversationId });
          if (generated.outcome === "unchanged") return;
          await deps.saveTitle({
            projectId,
            conversationId,
            turnId,
            title: generated.title,
            model: generated.model,
          });
        },
      },
    };
  }
}

function dispatchIntentOf({
  resumable,
  hasApiKey,
}: {
  resumable: boolean;
  hasApiKey: boolean;
}): DispatchIntent {
  if (resumable) return "revive";
  return hasApiKey ? "create" : "continue";
}
