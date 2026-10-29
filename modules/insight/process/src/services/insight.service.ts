import type { FileInsightInput, InsightAction, InsightEntry } from "@langwatch/insight-contract";
import { generate, KSUID_RESOURCES } from "@langwatch/ksuid";
import { LANGY_CONVERSATION_ORIGIN, type LangyApi } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";

import type { InsightRepository } from "../repositories/insight.repository.ts";
import { mintInsightActions } from "../rules/insight-action.rules.ts";
import type { InsightCommandsService } from "./insight-commands.service.ts";

type SourceConversations = Pick<LangyApi, "findByIdVisible">;

/** How many of one person's newest insights in a project one inbox read carries. */
const INBOX_READ_LIMIT = 500;

/**
 * One person's inbox: reads come from the projections and answer only what the reader owns,
 * writes go out as commands. A write answers before the worker folds it, so a filing answers
 * the entry it will become.
 */
export class InsightService {
  private constructor(
    private readonly insights: InsightRepository,
    private readonly commands: InsightCommandsService,
    private readonly conversations: SourceConversations,
  ) {}

  static create({
    insights,
    commands,
    conversations,
  }: {
    insights: InsightRepository;
    commands: InsightCommandsService;
    /** Asked only when a filing carries actions: is its source a run's conversation? */
    conversations: SourceConversations;
  }): InsightService {
    return new InsightService(insights, commands, conversations);
  }

  findForReader({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InsightEntry[]> {
    return this.insights.findForReader({ projectId, userId, limit: INBOX_READ_LIMIT });
  }

  async file({ userId, ...input }: FileInsightInput & { userId: string }): Promise<InsightEntry> {
    const occurredAt = nowInstant().epochMilliseconds;
    const filed = {
      insightId: generate(KSUID_RESOURCES.INSIGHT).toString(),
      title: input.title,
      body: input.body,
      tone: input.tone,
      topic: input.topic ?? null,
      validDays: input.validDays,
      lwql: input.lwql ?? null,
      replay: input.replay ?? null,
      source: input.source ?? null,
      board: input.board ?? null,
      // A member's own filing; the scheduled run will be the one to say "run", and to name an
      // owner who filed nothing.
      filedVia: "chat" as const,
      ownerUserId: userId,
      filedByUserId: userId,
      // Only a run names its finding; a saved answer is matched by nothing.
      findingKey: null,
      actions: await this.actionsOf({ ...input, userId }),
    };
    const { insightId, ...entry } = filed;
    await this.commands.fileInsight({ tenantId: input.projectId, occurredAt, ...filed });
    // The owner filed it themselves, so they have seen it: it must not light their own bell.
    await this.commands.markInsightSeen({
      tenantId: input.projectId,
      occurredAt,
      insightId,
      userId,
    });
    return {
      id: insightId,
      ...entry,
      filedAt: occurredAt,
      renewedAt: null,
      seenAt: occurredAt,
      archivedAt: null,
      keptAt: null,
    };
  }

  /**
   * The filing's actions with their ids; none when it was saved from a run's conversation, whose
   * history holds trace text nobody vetted.
   */
  private async actionsOf({
    projectId,
    userId,
    source,
    actions = [],
  }: Pick<FileInsightInput, "projectId" | "source" | "actions"> & {
    userId: string;
  }): Promise<InsightAction[]> {
    if (actions.length === 0) return [];
    if (source) {
      const conversation = await this.conversations.findByIdVisible({
        id: source.conversationId,
        projectId,
        userId,
      });
      if (conversation?.origin === LANGY_CONVERSATION_ORIGIN.RUN) return [];
    }
    return mintInsightActions(actions);
  }

  /**
   * Only what this reader owns and has not seen yet goes out, so an id they do not own is
   * skipped like an id no insight has.
   */
  async markSeen({
    projectId,
    userId,
    insightIds,
  }: {
    projectId: string;
    userId: string;
    insightIds: readonly string[];
  }): Promise<void> {
    const wanted = new Set(insightIds);
    const unseen = (await this.findForReader({ projectId, userId })).filter(
      (entry) => wanted.has(entry.id) && entry.seenAt === null,
    );
    const occurredAt = nowInstant().epochMilliseconds;
    await Promise.all(
      unseen.map((entry) =>
        this.commands.markInsightSeen({
          tenantId: projectId,
          occurredAt,
          insightId: entry.id,
          userId,
        }),
      ),
    );
  }

  /** Owner only: `getForReader` refuses another person's insight as it does an unknown id. */
  async archive(scope: { projectId: string; insightId: string; userId: string }): Promise<void> {
    await this.insights.getForReader(scope);
    await this.commands.archiveInsight(this.readerAct(scope));
  }

  async keep(scope: { projectId: string; insightId: string; userId: string }): Promise<void> {
    await this.insights.getForReader(scope);
    await this.commands.keepInsight(this.readerAct(scope));
  }

  private readerAct({
    projectId,
    insightId,
    userId,
  }: {
    projectId: string;
    insightId: string;
    userId: string;
  }) {
    return { tenantId: projectId, occurredAt: nowInstant().epochMilliseconds, insightId, userId };
  }
}
