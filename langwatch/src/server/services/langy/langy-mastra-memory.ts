/**
 * MastraMemory adapter (PR-4.4b).
 *
 * Adopts Mastra's `MastraMemory` primitive (Thread/Resource model) on top of
 * the existing `LangyMessageService` + `LangyConversationService`. When the
 * `release_ui_langy_mastra_enabled` flag is on, this adapter is the sole
 * writer of assistant/tool turns on the Mastra path — the legacy `onFinish`
 * callback is dropped on that branch (see routes/langy.ts).
 *
 * Mapping:
 *   Mastra `threadId`   → Langy `conversationId`
 *   Mastra `resourceId` → Langy `projectId` (multitenancy boundary)
 *
 * Scope kept intentionally narrow for PR-4.4b:
 *   - saveMessages, recall, getThreadById, saveThread, listThreads:
 *     real implementations backed by Langy services.
 *   - working memory, semantic recall, thread cloning/deletion, message
 *     deletion: NOT supported in this PR. The corresponding abstract methods
 *     throw `LangyMastraMemoryUnsupportedError` so we discover early if the
 *     Mastra chat path starts depending on them. These follow up in PR-4.5+.
 */
import { MastraMemory } from "@mastra/core/memory";
import type {
  MastraDBMessage,
  MastraMessageV1,
  MessageDeleteInput,
  StorageThreadType,
  WorkingMemoryTemplate,
} from "@mastra/core/memory";
import type {
  StorageCloneThreadInput,
  StorageCloneThreadOutput,
  StorageListMessagesInput,
  StorageListThreadsInput,
  StorageListThreadsOutput,
} from "@mastra/core/storage";
import type { LangyMessage } from "@prisma/client";
import type {
  LangyConversationService,
} from "./LangyConversationService";
import type {
  CreateMessageInput,
  LangyMessageService,
  MessageRole,
} from "./LangyMessageService";

export class LangyMastraMemoryUnsupportedError extends Error {
  constructor(method: string) {
    super(
      `LangyMastraMemory does not implement ${method}; this surface is scheduled for PR-4.5+ (see langy-mastra-memory.ts).`,
    );
    this.name = "LangyMastraMemoryUnsupportedError";
  }
}

export interface LangyMastraMemoryDeps {
  messageService: LangyMessageService;
  conversationService: LangyConversationService;
  /**
   * Tenant boundary. Bound at construction (per-request) so every read/write
   * is implicitly scoped — callers do not pass projectId per call.
   */
  projectId: string;
  /**
   * Owner of conversations created via Mastra's createThread() helper.
   * Needed because conversations on Langy require a userId, but Mastra's
   * thread model only carries (threadId, resourceId).
   */
  userId: string;
}

/**
 * Mastra v0+ stores `MastraMessageContentV2` in `MastraDBMessage.content`.
 * We persist the whole content object into our existing JSONB `parts`
 * column on `LangyMessage` so the round-trip is lossless without a schema
 * change. `parts` is typed `unknown` on the message table.
 */
type StoredContent =
  | MastraDBMessage["content"]
  | unknown[]; // legacy shape from the AI-SDK path (PR-4.4 part a and earlier)

function mapRoleToLangy(role: MastraDBMessage["role"]): MessageRole {
  // `MastraDBMessage.role` is 'user' | 'assistant' | 'system'. Tool results
  // are nested as parts inside an assistant message in Mastra's V2 schema,
  // so there is no top-level 'tool' role to map here.
  return role;
}

function mapRoleToMastra(role: MessageRole): MastraDBMessage["role"] {
  // Older Langy rows can carry a top-level 'tool' role (legacy onFinish
  // path persisted tool messages separately). Mastra's V2 row schema only
  // allows user|assistant|system, so we fold 'tool' onto 'assistant' on
  // read-back — Mastra will still see the tool parts via `content.parts`.
  return role === "tool" ? "assistant" : role;
}

function langyRowToMastraMessage(row: LangyMessage): MastraDBMessage {
  const stored = row.parts as StoredContent;
  const content =
    stored && typeof stored === "object" && !Array.isArray(stored) &&
    (stored as { format?: number }).format === 2
      ? (stored as MastraDBMessage["content"])
      : ({
          format: 2,
          parts: Array.isArray(stored)
            ? (stored as MastraDBMessage["content"]["parts"])
            : [],
        } satisfies MastraDBMessage["content"]);
  return {
    id: row.id,
    role: mapRoleToMastra(row.role as MessageRole),
    createdAt: row.createdAt,
    threadId: row.conversationId,
    resourceId: row.projectId,
    content,
  };
}

export class LangyMastraMemory extends MastraMemory {
  private readonly deps: LangyMastraMemoryDeps;

  constructor(deps: LangyMastraMemoryDeps) {
    super({ name: "langy" });
    this.deps = deps;
  }

  /**
   * Persist new messages produced during an agent turn.
   *
   * `MessageList` inside Agent filters this down to messages whose
   * source is 'response' (i.e. newly produced this turn) before calling
   * us — so we don't dedup against existing rows here.
   */
  override async saveMessages({
    messages,
  }: {
    messages: MastraDBMessage[];
  }): Promise<{ messages: MastraDBMessage[] }> {
    const scoped = messages.filter(
      (m) => m.threadId !== undefined && m.resourceId === this.deps.projectId,
    );
    if (scoped.length === 0) {
      return { messages };
    }
    const inputs: CreateMessageInput[] = scoped.map((m) => ({
      conversationId: m.threadId!,
      projectId: this.deps.projectId,
      role: mapRoleToLangy(m.role),
      parts: m.content,
    }));
    await this.deps.messageService.appendMany(inputs);
    // Touch the conversation so the sidebar's "recent" ordering reflects
    // this turn — parity with the legacy onFinish path.
    const threadIds = Array.from(
      new Set(scoped.map((m) => m.threadId).filter(Boolean) as string[]),
    );
    await Promise.all(
      threadIds.map((threadId) =>
        this.deps.conversationService.touch({
          id: threadId,
          projectId: this.deps.projectId,
        }),
      ),
    );
    return { messages };
  }

  override async recall(args: StorageListMessagesInput & {
    threadConfig?: unknown;
    vectorSearchString?: string;
    includeSystemReminders?: boolean;
  }): Promise<{
    messages: MastraDBMessage[];
    total: number;
    page: number;
    perPage: number | false;
    hasMore: boolean;
  }> {
    const threadId = Array.isArray(args.threadId)
      ? args.threadId[0]
      : args.threadId;
    if (!threadId) {
      return { messages: [], total: 0, page: 0, perPage: false, hasMore: false };
    }
    const rows = await this.deps.messageService.getAllByConversation({
      conversationId: threadId,
      projectId: this.deps.projectId,
    });
    const messages = rows.map(langyRowToMastraMessage);
    return {
      messages,
      total: messages.length,
      page: 0,
      perPage: false,
      hasMore: false,
    };
  }

  override async getThreadById({
    threadId,
  }: {
    threadId: string;
  }): Promise<StorageThreadType | null> {
    const conv = await this.deps.conversationService.getById({
      id: threadId,
      projectId: this.deps.projectId,
      userId: this.deps.userId,
    });
    if (!conv) return null;
    return {
      id: conv.id,
      title: conv.title ?? undefined,
      resourceId: this.deps.projectId,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      metadata: {},
    };
  }

  override async saveThread({
    thread,
  }: {
    thread: StorageThreadType;
  }): Promise<StorageThreadType> {
    // Conversations are created up-front by the route via
    // `LangyConversationService.ensureConversation`, so saveThread on the
    // chat path is a no-op that just echoes the input. Returning a fresh
    // object would erase fields Mastra has stamped (title, metadata).
    return thread;
  }

  override async listThreads(
    args: StorageListThreadsInput,
  ): Promise<StorageListThreadsOutput> {
    if (args.filter?.resourceId && args.filter.resourceId !== this.deps.projectId) {
      // Cross-tenant listing is not supported — the adapter is bound to a
      // single project at construction.
      return { threads: [], total: 0, page: 0, perPage: false, hasMore: false };
    }
    const rows = await this.deps.conversationService.getAll({
      projectId: this.deps.projectId,
      userId: this.deps.userId,
    });
    const threads: StorageThreadType[] = rows.map((r) => ({
      id: r.id,
      title: r.title ?? undefined,
      resourceId: this.deps.projectId,
      createdAt: r.updatedAt,
      updatedAt: r.updatedAt,
      metadata: {},
    }));
    return {
      threads,
      total: threads.length,
      page: 0,
      perPage: false,
      hasMore: false,
    };
  }

  override async deleteThread(_threadId: string): Promise<void> {
    throw new LangyMastraMemoryUnsupportedError("deleteThread");
  }

  override async deleteMessages(
    _messageIds: MessageDeleteInput,
  ): Promise<void> {
    throw new LangyMastraMemoryUnsupportedError("deleteMessages");
  }

  override async cloneThread(
    _args: StorageCloneThreadInput,
  ): Promise<StorageCloneThreadOutput> {
    throw new LangyMastraMemoryUnsupportedError("cloneThread");
  }

  override async getWorkingMemory(_args: {
    threadId: string;
    resourceId?: string;
    memoryConfig?: unknown;
  }): Promise<string | null> {
    return null;
  }

  override async getWorkingMemoryTemplate(_args?: {
    memoryConfig?: unknown;
  }): Promise<WorkingMemoryTemplate | null> {
    return null;
  }

  override async updateWorkingMemory(_args: {
    threadId: string;
    resourceId?: string;
    workingMemory: string;
    memoryConfig?: unknown;
    observabilityContext?: unknown;
  }): Promise<void> {
    throw new LangyMastraMemoryUnsupportedError("updateWorkingMemory");
  }

  override async __experimental_updateWorkingMemoryVNext(_args: {
    threadId: string;
    resourceId?: string;
    workingMemory: string;
    searchString?: string;
    memoryConfig?: unknown;
  }): Promise<{ success: boolean; reason: string }> {
    return {
      success: false,
      reason: "working memory is not implemented by LangyMastraMemory (PR-4.5+).",
    };
  }
}

export type { MastraMessageV1 };
