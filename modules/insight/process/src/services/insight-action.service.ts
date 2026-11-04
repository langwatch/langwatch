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
import { createLogger, type Logger } from "@langwatch/observability";
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

const MODULE_LOGGER = createLogger("langwatch:insight:action");

const REAL_CLOCK: InsightActionClock = {
  now: () => nowInstant().epochMilliseconds,
  sleep: (ms) => wait(ms),
};

const FORK_READY_TIMEOUT_MS = 5_000;
const FORK_READY_POLL_MS = 200;

type InsightActionDependencies = Readonly<{
  insights: Pick<InsightRepository, "getForReader">;
  langy: ActionLangy;
  clock: InsightActionClock;
  logger: Pick<Logger, "warn">;
}>;

type ForkToAwait = Readonly<{
  id: string;
  messageCount: number;
  projectId: string;
  userId: string;
}>;

/**
 * Sends one stored action to Langy as the person who clicked it. The turn always lands in a
 * conversation of theirs: the source when they own it, a fork when they do not, a new seeded
 * one when it is gone or the fork is late. Nobody else's conversation is written to.
 * @see modules/insight/adrs/005-insight-actions.md
 */
export class InsightActionService {
  private readonly insights: InsightActionDependencies["insights"];
  private readonly langy: ActionLangy;
  private readonly clock: InsightActionClock;
  private readonly logger: InsightActionDependencies["logger"];

  private constructor(dependencies: InsightActionDependencies) {
    this.insights = dependencies.insights;
    this.langy = dependencies.langy;
    this.clock = dependencies.clock;
    this.logger = dependencies.logger;
  }

  static create({
    clock = REAL_CLOCK,
    logger = MODULE_LOGGER,
    ...peers
  }: Omit<InsightActionDependencies, "clock" | "logger"> &
    Partial<Pick<InsightActionDependencies, "clock" | "logger">>): InsightActionService {
    return new InsightActionService({ ...peers, clock, logger });
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
  private async isForkReady(fork: ForkToAwait): Promise<boolean> {
    const deadline = this.clock.now() + FORK_READY_TIMEOUT_MS;
    const wait = { hasWarned: false };
    while (this.clock.now() < deadline) {
      if (await this.hasForkLanded({ fork, wait })) return true;
      const left = Math.max(0, deadline - this.clock.now());
      await this.clock.sleep(Math.min(FORK_READY_POLL_MS, left));
    }
    // The last sleep ended at the deadline, and the fork may have landed during it.
    return this.hasForkLanded({ fork, wait });
  }

  /**
   * A read that fails is not a verdict on the fork: it is not ready, and the seeded path runs. It
   * is logged once per wait, since a wait reads about 25 times, naming the fork, never its words.
   */
  private async hasForkLanded({
    fork: { id, messageCount, projectId, userId },
    wait,
  }: {
    fork: ForkToAwait;
    wait: { hasWarned: boolean };
  }) {
    try {
      const fork = await this.langy.findByIdVisible({ id, projectId, userId });
      return fork?.isOwn === true && fork.messageCount >= messageCount;
    } catch (error) {
      if (!wait.hasWarned) {
        this.logger.warn({ error, forkId: id }, "could not read a fork a click is waiting for");
      }
      wait.hasWarned = true;
      return false;
    }
  }
}
