import { setTimeout as wait } from "node:timers/promises";

import {
  InsightActionFromRunError,
  InsightActionNotFoundError,
  type InsightActionRun,
  type RunInsightActionInput,
} from "@langwatch/insight-contract";
import {
  LANGY_CONVERSATION_ORIGIN,
  type LangyApi,
  type LangyPanelCaller,
} from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";

import type { InsightRepository } from "../repositories/insight.repository.ts";
import {
  insightActionIdempotencyKey,
  insightActionMessage,
} from "../rules/insight-action.rules.ts";

type ActionLangy = Pick<
  LangyApi,
  "findByIdVisible" | "forkConversation" | "createConversationTurn" | "continueConversationTurn"
>;

/** Time and waiting, so a test can drive a fork landing late without really waiting. */
export type InsightActionClock = Readonly<{
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}>;

const REAL_CLOCK: InsightActionClock = {
  now: () => nowInstant().epochMilliseconds,
  sleep: (ms) => wait(ms),
};

const FORK_READY_TIMEOUT_MS = 5_000;
const FORK_READY_POLL_MS = 200;

/**
 * Sends one stored action to Langy as the person who clicked it. The turn always lands in a
 * conversation of theirs: the source when they own it, a fork when they do not, a new seeded
 * one when it is gone or the fork is late. Nobody else's conversation is written to.
 * @see modules/insight/adrs/005-insight-actions.md
 */
export class InsightActionService {
  private constructor(
    private readonly insights: Pick<InsightRepository, "getForReader">,
    private readonly langy: ActionLangy,
    private readonly clock: InsightActionClock,
  ) {}

  static create({
    insights,
    langy,
    clock = REAL_CLOCK,
  }: {
    insights: Pick<InsightRepository, "getForReader">;
    langy: ActionLangy;
    clock?: InsightActionClock;
  }): InsightActionService {
    return new InsightActionService(insights, langy, clock);
  }

  async run({
    caller,
    ...input
  }: RunInsightActionInput & { caller: LangyPanelCaller }): Promise<InsightActionRun> {
    const { projectId, insightId, actionId } = input;
    const insight = await this.insights.getForReader({
      projectId,
      insightId,
      userId: caller.userId,
    });
    if (insight.filedVia === "run") throw new InsightActionFromRunError(insightId);
    const action = insight.actions.find((candidate) => candidate.id === actionId);
    if (!action) throw new InsightActionNotFoundError(actionId);

    const source = insight.source
      ? await this.langy.findByIdVisible({
          id: insight.source.conversationId,
          projectId,
          userId: caller.userId,
        })
      : null;
    // A run's history holds trace text nobody vetted; nothing is sent on from it.
    if (source?.origin === LANGY_CONVERSATION_ORIGIN.RUN) {
      throw new InsightActionFromRunError(insightId);
    }

    const turn = ({ isSeeded }: { isSeeded: boolean }) => ({
      projectId,
      caller,
      idempotencyKey: insightActionIdempotencyKey(input),
      messages: [
        {
          role: "user" as const,
          parts: [
            {
              type: "text",
              text: insightActionMessage({ insight, prompt: action.prompt, isSeeded }),
            },
          ],
        },
      ],
    });
    const asExpected = { sourceGone: false, forkNotReady: false, forkTitle: null };

    if (source === null) {
      const started = await this.langy.createConversationTurn(turn({ isSeeded: true }));
      // Gone only when there was one: an insight filed with no conversation lost nothing.
      return { ...started, ...asExpected, sourceGone: insight.source !== null };
    }
    if (source.isOwn) {
      const started = await this.langy.continueConversationTurn({
        ...turn({ isSeeded: false }),
        conversationId: source.id,
      });
      return { ...started, ...asExpected };
    }

    const fork = await this.langy.forkConversation({
      projectId,
      conversationId: source.id,
      caller,
    });
    const isReady = await this.isForkReady({
      id: fork.id,
      messageCount: fork.messageCount,
      projectId,
      userId: caller.userId,
    });
    if (!isReady) {
      const started = await this.langy.createConversationTurn(turn({ isSeeded: true }));
      return { ...started, ...asExpected, forkNotReady: true, forkTitle: fork.title };
    }
    const started = await this.langy.continueConversationTurn({
      ...turn({ isSeeded: false }),
      conversationId: fork.id,
    });
    return { ...started, ...asExpected };
  }

  /**
   * A fork only sends commands, and the worker folds them later. A turn sent before the row reads
   * as the clicker's mints an empty conversation; one sent before the copied messages land runs
   * without their history. So the wait is for both, and the count is what the fork said it copied.
   */
  private async isForkReady({
    id,
    messageCount,
    projectId,
    userId,
  }: {
    id: string;
    messageCount: number;
    projectId: string;
    userId: string;
  }): Promise<boolean> {
    const deadline = this.clock.now() + FORK_READY_TIMEOUT_MS;
    while (this.clock.now() < deadline) {
      const fork = await this.langy.findByIdVisible({ id, projectId, userId });
      if (fork?.isOwn && fork.messageCount >= messageCount) return true;
      const left = Math.max(0, deadline - this.clock.now());
      await this.clock.sleep(Math.min(FORK_READY_POLL_MS, left));
    }
    return false;
  }
}
