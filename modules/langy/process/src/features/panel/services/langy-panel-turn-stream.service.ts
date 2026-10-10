import {
  LangyConversationNotFoundError,
  type LangyPanelCall,
  type LangyStreamEntry,
  type langyTurnStreamInputSchema,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type { LangyTurnAccessRepository } from "../../../repositories/langy-live-turn.repository.ts";
import { turnHealthOf } from "../../../rules/langy-turn-settlement.rules.ts";
import type { TurnHealth } from "../../../rules/langy-turn-settlement.rules.ts";
import type { LangyService } from "../../../services/langy.service.ts";
import type { OpenLangyTurnBuffer } from "../../turn/services/langy-turn-settlement-waiter.service.ts";
import { LangyTurnTailService } from "../../turn/services/langy-turn-tail.service.ts";
import type { LangyPanelAccessService } from "./langy-panel-access.service.ts";

const logger = createLogger("langwatch:langy:panel");

export type LangyPanelTurnStreamMembers = Readonly<{
  access: LangyPanelAccessService;
  langy: Pick<LangyService, "getById" | "findByIdVisible">;
  turnAccess: LangyTurnAccessRepository;
  openBuffer: OpenLangyTurnBuffer;
}>;

/**
 * The panel attaching to one turn's live edge. Spec: modules/langy/specs/langy-panel-trpc.feature
 */
export class LangyPanelTurnStreamService {
  static create(members: LangyPanelTurnStreamMembers): LangyPanelTurnStreamService {
    return new LangyPanelTurnStreamService(members);
  }

  private constructor(private readonly members: LangyPanelTurnStreamMembers) {}

  /** One turn's live edge; "no such turn" and "not yours" answer the same not-found. */
  async *watchTurnStream(
    input: LangyPanelCall<typeof langyTurnStreamInputSchema> & { signal?: AbortSignal },
  ): AsyncGenerator<LangyStreamEntry> {
    await this.members.access.assertPanelAccess(input);
    const { projectId, conversationId, turnId } = input;
    const userId = input.caller.userId;
    if (!(await this.canWatchTurn({ projectId, conversationId, turnId, userId }))) {
      logger.warn(
        { projectId, conversationId, turnId, userId },
        "denied a langy turn-stream attach",
      );
      throw new LangyConversationNotFoundError(conversationId);
    }
    const { buffer, release } = this.members.openBuffer();
    yield* LangyTurnTailService.create().streamTurnEntries({
      conversationId,
      turnId,
      buffer,
      readHealth: () => this.readTurnHealth({ projectId, conversationId, turnId, userId, buffer }),
      signal: input.signal ?? new AbortController().signal,
      release,
      onAbandoned: ({ stalePolls }) =>
        logger.warn(
          { projectId, conversationId, turnId, stalePolls },
          "giving up a turn stream whose turn neither settled nor beat",
        ),
    });
  }

  /** The turn's own actor first, so a just-started turn does not 404 before its fold lands. */
  private async canWatchTurn(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<boolean> {
    if (await this.members.turnAccess.isTurnActor(input)) {
      return true;
    }
    const conversation = await this.members.langy.findByIdVisible({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.userId,
    });
    return conversation !== null;
  }

  /** One look at the fold and the heartbeat; a failed read says nothing about the turn. */
  private async readTurnHealth(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
    buffer: {
      liveness(a: { conversationId: string; turnId: string }): Promise<{ stale: boolean }>;
    };
  }): Promise<TurnHealth | null> {
    const [conversation, liveness] = await Promise.all([
      this.members.langy
        .getById({ id: input.conversationId, projectId: input.projectId, userId: input.userId })
        .catch(() => null),
      input.buffer
        .liveness({ conversationId: input.conversationId, turnId: input.turnId })
        .catch(() => null),
    ]);
    if (!conversation || !liveness) return null;
    return turnHealthOf({ conversation, liveness });
  }
}
