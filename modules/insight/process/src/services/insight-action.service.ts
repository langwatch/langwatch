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

import type { InsightRepository } from "../repositories/insight.repository.ts";
import {
  insightActionIdempotencyKey,
  insightActionMessage,
} from "../rules/insight-action.rules.ts";

type ActionLangy = Pick<
  LangyApi,
  "findByIdVisible" | "forkConversation" | "createConversationTurn" | "continueConversationTurn"
>;

/**
 * Sends one stored action to Langy as the person who clicked it. The turn always lands in a
 * conversation of theirs: the source when they own it, a fork when they do not, a new one
 * seeded with the insight when it is gone. Nobody else's conversation is written to.
 * @see modules/insight/adrs/005-insight-actions.md
 */
export class InsightActionService {
  private constructor(
    private readonly insights: Pick<InsightRepository, "getForReader">,
    private readonly langy: ActionLangy,
  ) {}

  static create({
    insights,
    langy,
  }: {
    insights: Pick<InsightRepository, "getForReader">;
    langy: ActionLangy;
  }): InsightActionService {
    return new InsightActionService(insights, langy);
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

    const turn = {
      projectId,
      caller,
      idempotencyKey: insightActionIdempotencyKey(input),
      messages: [
        {
          role: "user" as const,
          parts: [
            {
              type: "text",
              text: insightActionMessage({
                insight,
                prompt: action.prompt,
                isSeeded: source === null,
              }),
            },
          ],
        },
      ],
    };
    if (source === null) {
      const started = await this.langy.createConversationTurn(turn);
      return { ...started, sourceGone: true };
    }
    const conversationId = source.isOwn
      ? source.id
      : (await this.langy.forkConversation({ projectId, conversationId: source.id, caller })).id;
    const started = await this.langy.continueConversationTurn({ ...turn, conversationId });
    return { ...started, sourceGone: false };
  }
}
