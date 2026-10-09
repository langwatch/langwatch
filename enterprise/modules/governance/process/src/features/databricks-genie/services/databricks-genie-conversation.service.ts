// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One Genie space's conversations, walked in order and read into visibility records. */

import { DATABRICKS_GENIE_ADAPTER_ID } from "@langwatch/enterprise-governance-contract";
import type {
  DatabricksGeniePullConfig,
  NormalizedPullEvent,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { z } from "zod";

import {
  type conversationSchema,
  type GenieIdentity,
  messageEvent,
  messagesPageSchema,
} from "../rules/databricks-genie-message-event.rules.ts";
import {
  type conversationWalkPlan,
  earlierOf,
  genieEpochMs,
  PENDING_SETTLE_GRACE_MS,
  type PagedRead,
  type SpaceRead,
  stoppedAt,
} from "../rules/databricks-genie-sweep.rules.ts";
import type { GenieSpace } from "../rules/genie-spaces.rules.ts";
import { TERMINAL_MESSAGE_STATUSES } from "../rules/genie-trace-mapper-service.rules.ts";
import type { DatabricksGenieRunBudgetService } from "./databricks-genie-run-budget.service.ts";
import type { DatabricksGenieWorkspaceService } from "./databricks-genie-workspace.service.ts";

const logger = createLogger("langwatch:governance:databricks-genie-puller");

export class DatabricksGenieConversationService {
  private constructor(private readonly workspace: DatabricksGenieWorkspaceService) {}

  static create(workspace: DatabricksGenieWorkspaceService): DatabricksGenieConversationService {
    return new DatabricksGenieConversationService(workspace);
  }

  /**
   * Reads one space's conversations in the planned order, stopping when the
   * budget runs out.
   *
   * Stopping hands back the conversation to restart ON — not the one after it
   * — so a conversation whose message pages were cut partway is re-read rather
   * than half-skipped.
   */
  async walkConversations({
    config,
    token,
    options,
    budget,
    space,
    sinceMs,
    identities,
    conversationPlan,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    space: GenieSpace;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
    conversationPlan: ReturnType<typeof conversationWalkPlan>;
  }): Promise<SpaceRead> {
    const events: NormalizedPullEvent[] = [];
    let complete = true;
    // Set when the walk carries on past a conversation it could not read.
    let hadGap = false;
    let oldestPendingMs: number | null = null;

    for (let i = conversationPlan.startAt; i < conversationPlan.ordered.length; i += 1) {
      const conversation = conversationPlan.ordered[i]!;
      if (budget.exhausted()) {
        return stoppedAt({
          items: events,
          conversation,
          hadGap,
          oldestPendingMs,
          conversationPlan,
        });
      }

      const step = await this.readConversation({
        config,
        token,
        options,
        budget,
        space,
        conversation,
        sinceMs,
        identities,
      });

      events.push(...step.events);
      complete = complete && !step.unfinished;
      hadGap = hadGap || step.failed;
      // Not a gap: nothing was skipped. It only keeps the watermark behind this
      // message so the sweep comes back once the warehouse has answered.
      if (step.oldestPendingMs !== null) {
        oldestPendingMs = earlierOf(oldestPendingMs, step.oldestPendingMs);
      }

      // Out of budget with this conversation unfinished — resume ON it so its
      // tail is re-read. An isolated failure with budget still left falls
      // through and keeps going, so one broken conversation cannot wedge the
      // space; `hadGap` is what stops the watermark for it instead.
      if (step.unfinished && budget.exhausted()) {
        return stoppedAt({
          items: events,
          conversation,
          hadGap,
          oldestPendingMs,
          conversationPlan,
        });
      }
    }

    return {
      items: events,
      complete,
      resumeConversationId: null,
      hadGap,
      oldestPendingMs,
    };
  }

  /**
   * One conversation folded into the walk: what it produced, and how it ended.
   *
   * Isolated — a single conversation the credential cannot see, or one that
   * 429s, must not cost the space the rest of its conversations. `failed` is
   * that case and becomes a gap, which holds the watermark. `unfinished` also
   * covers a clean budget cut partway through its pages, which is NOT a gap
   * because the walk stops right there rather than stepping over anything.
   */
  private async readConversation({
    config,
    token,
    options,
    budget,
    space,
    conversation,
    sinceMs,
    identities,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    space: GenieSpace;
    conversation: z.infer<typeof conversationSchema>;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
  }): Promise<{
    events: NormalizedPullEvent[];
    unfinished: boolean;
    failed: boolean;
    /**
     * The oldest message in it that may still change, or null if none can.
     * A ceiling on the watermark, not a veto on it.
     */
    oldestPendingMs: number | null;
  }> {
    const isolated = await this.workspace.isolate({
      what: "messages",
      context: {
        spaceId: space.space_id,
        conversationId: conversation.conversation_id,
      },
      run: () =>
        this.conversationMessages({
          config,
          token,
          options,
          budget,
          space,
          conversation,
          sinceMs,
          identities,
        }),
    });
    const read = isolated.ok ? isolated.value : null;
    return {
      events: read?.items ?? [],
      unfinished: read === null || !read.complete,
      failed: read === null,
      oldestPendingMs: read?.oldestPendingMs ?? null,
    };
  }

  /** Every new message in one conversation, mapped to events. */
  private async conversationMessages({
    config,
    token,
    options,
    budget,
    space,
    conversation,
    sinceMs,
    identities,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    space: GenieSpace;
    conversation: z.infer<typeof conversationSchema>;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
  }): Promise<PagedRead<NormalizedPullEvent> & { oldestPendingMs: number | null }> {
    const messages = await this.workspace.paginate({
      config,
      token,
      options,
      budget,
      path: `/api/2.0/genie/spaces/${encodeURIComponent(space.space_id)}/conversations/${encodeURIComponent(conversation.conversation_id)}/messages`,
      parse: (body) => {
        const page = messagesPageSchema.parse(body);
        return { items: page.messages, next: page.next_page_token };
      },
    });

    const events: NormalizedPullEvent[] = [];
    let oldestPendingMs: number | null = null;
    for (const message of messages.items) {
      const raw = message.created_timestamp;
      // A message with no timestamp cannot be placed against the watermark, and
      // emitting it would either re-emit it on every future sweep or file it
      // under `now`. Skipping it loses one row; the alternatives corrupt the
      // window for every row after it.
      if (raw === null || !Number.isFinite(raw)) {
        logger.warn(
          { adapter: DATABRICKS_GENIE_ADAPTER_ID, messageId: message.message_id },
          "genie message has no created_timestamp; skipping",
        );
        continue;
      }
      const createdMs = genieEpochMs(raw);
      if (createdMs <= sinceMs) continue;

      // Emitted either way — a question asked is a governance fact the moment
      // it is asked, and the OCSF sink replaces on message id, so the settled
      // version overwrites this one. What this buys is the guarantee that there
      // IS a next look: the watermark is kept behind the oldest message that
      // could still change, so the sweep comes back for it.
      if (DatabricksGenieConversationService.isSettling(message.status, createdMs)) {
        oldestPendingMs = earlierOf(oldestPendingMs, createdMs);
      }

      events.push(
        messageEvent({
          message,
          space,
          conversation,
          createdMs,
          identity: await this.workspace.identityFor({
            config,
            token,
            options,
            budget,
            userId: message.user_id,
            identities,
          }),
        }),
      );
    }
    return { items: events, complete: messages.complete, oldestPendingMs };
  }

  /** Whether this message may still gain the SQL we are here to record. */
  private static isSettling(status: string | null, createdMs: number): boolean {
    if (!status) return false;
    if (TERMINAL_MESSAGE_STATUSES.has(status)) return false;
    return nowInstant().epochMilliseconds - createdMs < PENDING_SETTLE_GRACE_MS;
  }
}
