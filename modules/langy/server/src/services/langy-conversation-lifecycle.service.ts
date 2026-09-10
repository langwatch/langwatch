import type { CommandEnvelope } from "@langwatch/eventing";
import { type TenantId } from "@langwatch/eventing";
import type { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import type {} from "@langwatch/langy-contract";
import { LANGY_CONVERSATION_STATUS } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { LangyTurnErrors } from "@langwatch/langy-contract";
import { mintRunToken } from "./langy-frame-auth.service.ts";
import type { LangyConversationProcessingEvent } from "../projections/langy-conversation-state.projection.ts";
import { LANGY_ID_RESOURCES } from "../processes/langy-conversation-process.types.ts";
import {
  LangyConversationNotFoundError,
  LangyConversationNotOwnedError,
} from "@langwatch/langy-contract";
import { type LangyFinalToolCall } from "./langy-final-parts.service.ts";
import type { LangyConversationRepository } from "../repositories/langy-conversation-projection.repository.ts";
import {
  type LangyMessageRepository,
  type LangyMessageRow,
} from "../repositories/langy-message.repository.ts";
import type { LangyTurnSegment } from "./langy-turn-order.service.ts";
import { nowInstant } from "@langwatch/time";

import {
  adoptConversationId,
  type ConversationDetail,
} from "../rules/langy-conversation-shape.rules.ts";
import type {
  LangyConversationCommands,
  LangyConversationRuntime,
} from "./langy-conversation.service.ts";
import { Temporal } from "@langwatch/time";

/**
 * A conversation's own life: created, adopted under a caller-chosen id, forked, renamed,
 * shared, archived, and cleared in bulk for one person.
 */
type LangyConversationLifecycleOptions = {
  repository: LangyConversationRepository;
  commands: LangyConversationCommands;
  messages: LangyMessageRepository;
  runtime: LangyConversationRuntime;
  /** The owning service's reads, so a lifecycle write sees the same visibility as a read. */
  getById: (input: {
    id: string;
    projectId: string;
    userId: string;
  }) => Promise<ConversationDetail>;
  findByIdVisible: (input: {
    id: string;
    projectId: string;
    userId: string;
  }) => Promise<ConversationDetail | null>;
};

export class LangyConversationLifecycleService {
  static create(deps: LangyConversationLifecycleOptions): LangyConversationLifecycleService {
    return new LangyConversationLifecycleService(deps);
  }

  private constructor(private readonly deps: LangyConversationLifecycleOptions) {}

  /**
   * Resolves the conversation id for a chat turn without writing (the
   * aggregate is created by the first `message_recorded`). With
   * `adoptUnknownId`, an unknown id is ADOPTED rather than minted, so a scenario run's fixed `threadId` gets one stable conversation across turns.
   */
  async ensureConversation({
    projectId,
    userId,
    conversationId,
    adoptUnknownId = false,
  }: {
    projectId: string;
    userId: string;
    conversationId?: string | null;
    adoptUnknownId?: boolean;
  }): Promise<{ id: string; isNew: boolean }> {
    if (!conversationId) {
      return { id: this.deps.runtime.generateId("conversation"), isNew: true };
    }

    // Resolve straight from the repo (not the share-aware getById): visibility
    // of a shared conversation does not grant continuation rights.
    const ownership = await this.deps.repository.findOwnership({
      id: conversationId,
      projectId,
      userId,
    });
    if (ownership === "owned") {
      return { id: conversationId, isNew: false };
    }

    if (ownership === "other") {
      throw new LangyConversationNotOwnedError(conversationId);
    }

    if (adoptUnknownId) {
      return adoptConversationId(conversationId, ownership);
    }

    // Archived / never existed: mint a fresh id — a stale id is legitimate
    // client state, unlike one owned by another user.
    return { id: this.deps.runtime.generateId("conversation"), isNew: true };
  }

  /**
   * Explicitly creates a conversation (`conversation_started`), seeding the
   * owner and optional title. Idempotent on the conversation
   * (`${tenantId}:${conversationId}:created`), so a retry collapses to one event.
   */
  async createConversation({
    projectId,
    userId,
    conversationId,
    title,
    runToken,
  }: {
    projectId: string;
    userId: string;
    conversationId?: string;
    title?: string | null;
    /**
     * The per-conversation runToken (`streaming/langyFrameAuth.ts`): stashed in
     * the turn handoff since dispatch reads it from there, not operational
     * state, which may not have consumed the creation event yet.
     */
    runToken?: string;
  }): Promise<{ id: string }> {
    const resolvedConversationId = conversationId ?? this.deps.runtime.generateId("conversation");
    await this.deps.commands.createConversation({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId: resolvedConversationId,
      userId,
      title: title ?? null,
      runToken: runToken ?? mintRunToken(),
    });

    return { id: resolvedConversationId };
  }

  /**
   * Branches a visible conversation into a fresh one owned by the caller.
   * Source projection is read once at command time; the new aggregate is
   * self-contained, so replay never needs the source to still exist.
   */
  async forkById({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{
    conversation: ConversationDetail;
    messages: LangyMessageRow[];
  }> {
    const source = await this.deps.getById({ id, projectId, userId });
    const sourceMessages = await this.deps.messages.findAllByConversation({
      conversationId: id,
      projectId,
    });

    const conversationId = this.deps.runtime.generateId("conversation");
    const title = `${source.title?.trim() || "Untitled chat"} (fork)`;
    const startedAt = this.deps.runtime.now();

    await this.deps.commands.forkConversation({
      tenantId: projectId,
      occurredAt: startedAt,
      conversationId,
      sourceConversationId: id,
      userId,
      title,
      runToken: mintRunToken(),
    });

    const importedMessages: LangyMessageRow[] = [];
    for (const [index, sourceMessage] of sourceMessages.entries()) {
      const messageId = this.deps.runtime.generateId("message");
      const occurredAt = startedAt + index + 1;
      await this.deps.commands.importMessage({
        tenantId: projectId,
        occurredAt,
        conversationId,
        sourceConversationId: id,
        sourceMessageId: sourceMessage.id,
        messageId,
        role: sourceMessage.role,
        parts: sourceMessage.parts,
      });
      importedMessages.push({
        id: messageId,
        role: sourceMessage.role,
        parts: sourceMessage.parts,
        createdAt: Temporal.Instant.fromEpochMilliseconds(occurredAt),
      });
    }

    const lastActivityAt = Temporal.Instant.fromEpochMilliseconds(
      startedAt + sourceMessages.length,
    );

    return {
      conversation: {
        id: conversationId,
        title,
        isShared: false,
        isOwn: true,
        lastActivityAt,
        messageCount: importedMessages.length,
        status: LANGY_CONVERSATION_STATUS.IDLE,
        // An import runs no turn — there is nothing in flight to stop.
        currentTurnId: null,
        lastError: null,
        // No turn ran here yet, so the fork carries no model of its own and
        // the composer falls back to the resolved default.
        lastModel: null,
        // The fork's projection has not landed yet, so there is no snapshot
        // position to seed from — the client folds from the start.
        eventCursor: null,
      },
      messages: importedMessages,
    };
  }

  /**
   * Per-conversation `runToken` (`streaming/langyFrameAuth.ts`), or null when
   * none exists. READ ONLY server-side — the worker-provisioning path injects
   * it and the relay verifies stream frames with it, same posture as the handoff token.
   */
  async findRunToken({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<string | null> {
    return this.deps.repository.tryFindRunToken({ projectId, conversationId });
  }

  async deleteById({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<boolean> {
    const conv = await this.deps.findByIdVisible({ id, projectId, userId });
    // Only the owner may archive — a shared conversation is visible, not deletable.
    if (!conv?.isOwn) {
      return false;
    }

    await this.deps.commands.archiveConversation({
      tenantId: projectId,
      occurredAt: this.deps.runtime.now(),
      conversationId: id,
    });

    return true;
  }

  async updateById({
    id,
    projectId,
    userId,
    title,
    isShared,
  }: {
    id: string;
    projectId: string;
    userId: string;
    title?: string | null;
    isShared?: boolean;
  }): Promise<ConversationDetail> {
    const conv = await this.deps.findByIdVisible({ id, projectId, userId });
    if (!conv?.isOwn) {
      // A shared conversation is visible but not editable by a non-owner; we do
      // not leak that distinction — both read as "not found" to the caller.
      throw new LangyConversationNotFoundError(id);
    }

    if (title === undefined && isShared === undefined) {
      return conv;
    }

    await this.deps.commands.updateConversationMetadata({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      conversationId: id,
      ...(title !== undefined ? { title } : {}),
      ...(isShared !== undefined ? { isShared, sharedById: isShared ? userId : null } : {}),
    });

    // Optimistic echo: the fold is written asynchronously, so return the
    // caller's intended state rather than a possibly-stale re-read.
    return {
      ...conv,
      title: title !== undefined ? title : conv.title,
      isShared: isShared !== undefined ? isShared : conv.isShared,
    };
  }

  async clearAllForUser({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<{ deletedCount: number }> {
    const ids = await this.deps.repository.findActiveOwnedIds({ projectId, userId });
    const now = this.deps.runtime.now();
    await Promise.all(
      ids.map((conversationId) =>
        this.deps.commands.archiveConversation({
          tenantId: projectId,
          occurredAt: now,
          conversationId,
        }),
      ),
    );

    return { deletedCount: ids.length };
  }
}
