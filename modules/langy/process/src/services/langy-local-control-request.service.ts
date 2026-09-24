/**
 * The control request binding a folder to a conversation (ADR-129). Owns
 * three properties: user-scoped visibility, single-use (SET NX), and a
 * 15-minute self-carried expiry.
 */

import { createLogger } from "@langwatch/observability";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { Temporal, nowInstant } from "@langwatch/time";
import { nanoid } from "nanoid";
import { z } from "zod";

/** The stored epoch millis as the ISO string the wire has always carried. */
function isoOf(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toString({ fractionalSecondDigits: 3 });
}
import {
  CONTROL_REQUEST_TTL_MS,
  SHARE_CONTROL_COMMAND,
  type ControlRequest,
  LangyLocalRecordUnreadableError,
  LangyLocalRequestExpiredError,
  LangyLocalRequestInvalidError,
} from "@langwatch/langy-contract";

import {
  controlRequestClaimKey,
  controlRequestKey,
  conversationKeyBindingsKey,
  sessionKeyBindingKey,
  userRequestsKey,
} from "../rules/langy-local-control-keys.rules.ts";

const logger = createLogger("langwatch:langy:local-control:requests");

const storedControlRequestSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  conversationTitle: z.string(),
  conversationUrl: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  userId: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  command: z.string(),
});
export type StoredControlRequest = z.infer<typeof storedControlRequestSchema>;

/** How long a minted session key may control its conversation. */
const KEY_BINDING_TTL_SECONDS = 6 * 60 * 60;

/**
 * How long the record outlives the request's own 15 minutes, so a late
 * approval reads "that request expired" rather than "not found".
 */
const RECORD_GRACE_MS = 30 * 60 * 1000;

/** What the socket reads to know which conversation a key answers for. */
export const sessionKeyBindingSchema = z.object({
  conversationId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  requestId: z.string(),
});
export type SessionKeyBinding = z.infer<typeof sessionKeyBindingSchema>;

/** What approving one request hands back to the command line. */
export interface ApprovedControlRequest {
  request: StoredControlRequest;
  /** The slug of the request's own project, for the conversation's address. */
  projectSlug: string;
  sessionKey: string;
  apiKeyId: string;
}

/** The one mint this service makes, as a type, so a test needs no database. */
export type ControlRequestKeyMinter = (args: {
  userId: string;
  projectId: string;
  organizationId: string;
}) => Promise<{ token: string; apiKeyId: string }>;

/** The two project facts this service reads: its slug and which organization
 * owns it. Reads for the request's own project, never the caller's, so a
 * device login on a personal project still approves for the team project the
 * conversation lives on. */
export type ControlRequestProjects = Readonly<{
  getOrganizationId(projectId: string): Promise<string>;
  getSlug(projectId: string): Promise<string>;
}>;

export interface ControlRequestServiceOptions {
  store: SessionStateStore;
  projects: ControlRequestProjects;
  /** Mints the per-conversation session key the command line authenticates with. */
  mintSessionKey: ControlRequestKeyMinter;
  now?: () => number;
  ttlMs?: number;
}

export class ControlRequestService {
  private readonly store: SessionStateStore;
  private readonly projects: ControlRequestProjects;
  private readonly ttlMs: number;
  private readonly mintSessionKey: ControlRequestKeyMinter;
  readonly now: () => number;

  static create(options: ControlRequestServiceOptions): ControlRequestService {
    return new ControlRequestService(options);
  }

  /**
   * The wire shape of one request, as the command line lists it. A static
   * method, not a `rules/` function, because it reads the clock's own
   * instant to format epoch millis as ISO strings - not a rules-module job.
   */
  static toWire(request: StoredControlRequest): ControlRequest {
    return {
      id: request.id,
      conversationId: request.conversationId,
      conversationTitle: request.conversationTitle,
      conversationUrl: request.conversationUrl,
      projectId: request.projectId,
      projectName: request.projectName,
      createdAt: isoOf(request.createdAt),
      expiresAt: isoOf(request.expiresAt),
    };
  }

  private constructor(options: ControlRequestServiceOptions) {
    this.store = options.store;
    this.projects = options.projects;
    this.now = options.now ?? (() => nowInstant().epochMilliseconds);
    this.ttlMs = options.ttlMs ?? CONTROL_REQUEST_TTL_MS;
    this.mintSessionKey = options.mintSessionKey;
  }

  /**
   * Records the request the code access card renders. A conversation holds
   * one open request at a time — a re-raised card supersedes the old one.
   */
  async create({
    projectId,
    projectName,
    userId,
    conversationId,
    conversationTitle,
    conversationUrl,
  }: {
    projectId: string;
    projectName: string;
    userId: string;
    conversationId: string;
    conversationTitle: string;
    conversationUrl: string;
  }): Promise<StoredControlRequest> {
    for (const older of await this.listOpen({ projectId, userId })) {
      if (older.conversationId !== conversationId) {
        continue;
      }

      await this.forget(older);
    }

    const createdAt = this.now();
    const request: StoredControlRequest = {
      id: `lcr_${nanoid()}`,
      conversationId,
      conversationTitle,
      conversationUrl,
      projectId,
      projectName,
      userId,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      command: SHARE_CONTROL_COMMAND,
    };
    await this.store.set(
      controlRequestKey(request.id),
      JSON.stringify(request),
      Math.ceil((this.ttlMs + RECORD_GRACE_MS) / 1000),
    );
    // The index is scored by expiry, so the list read drops a request that is
    // over even while the record it points at is still there to explain why.
    await this.store.zadd({
      key: userRequestsKey(userId),
      score: request.expiresAt,
      member: request.id,
      ttlSeconds: Math.ceil((this.ttlMs + RECORD_GRACE_MS) / 1000),
    });

    return request;
  }

  /**
   * The caller's own open requests, newest first: every project's, or one
   * project's when `projectId` is given. Expired members are dropped from
   * the index on the way.
   */
  async listOpen({
    userId,
    projectId,
  }: {
    userId: string;
    projectId?: string;
  }): Promise<StoredControlRequest[]> {
    const key = userRequestsKey(userId);
    const now = this.now();
    await this.store.zremrangebyscore(key, now);
    const ids = await this.store.zrangebyscore(key, now);
    const requests: StoredControlRequest[] = [];
    for (const id of ids) {
      let request: StoredControlRequest | null;
      try {
        request = await this.read(id);
      } catch (error) {
        if (!(error instanceof LangyLocalRecordUnreadableError)) {
          throw error;
        }

        logger.warn({ requestId: id }, "skipping unreadable control request");
        continue;
      }

      if (!request) {
        continue;
      }

      if (request.userId !== userId) {
        continue;
      }
      if (projectId !== undefined && request.projectId !== projectId) {
        continue;
      }

      requests.push(request);
    }

    return requests.toSorted((left, right) => right.createdAt - left.createdAt);
  }

  /** The open requests of one conversation, newest first, for the card waiting on them. */
  async findOpenForConversation({
    projectId,
    userId,
    conversationId,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
  }): Promise<StoredControlRequest[]> {
    const open = await this.listOpen({ projectId, userId });

    return open.filter((row) => row.conversationId === conversationId);
  }

  /**
   * The conversation one minted key controls, or nothing when it controls none.
   * A binding we wrote that no longer decodes is corruption, so it raises under
   * a code rather than reading back as a key that controls nothing.
   */
  async readKeyBinding(apiKeyId: string): Promise<SessionKeyBinding | null> {
    const raw = await this.store.tryGet(sessionKeyBindingKey(apiKeyId));
    if (!raw) {
      return null;
    }

    try {
      return sessionKeyBindingSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new LangyLocalRecordUnreadableError({
        reasons: error instanceof Error ? [error] : [],
      });
    }
  }

  /** Drops the binding, so the key stops answering for the conversation. */
  async revokeKeyBinding(apiKeyId: string): Promise<void> {
    const binding = await this.readKeyBinding(apiKeyId);
    await this.store.del(sessionKeyBindingKey(apiKeyId));
    if (binding) {
      await this.store.zrem(conversationKeyBindingsKey(binding.conversationId), apiKeyId);
    }
  }

  /**
   * Drops every binding for one conversation. Never reads presence — revoking
   * holds whether or not a socket is still there to be told about it.
   * @returns the keys that were revoked
   */
  async revokeConversationBindings(conversationId: string): Promise<string[]> {
    const key = conversationKeyBindingsKey(conversationId);
    const apiKeyIds = await this.store.zrangebyscore(key, 0);
    for (const apiKeyId of apiKeyIds) {
      await this.store.del(sessionKeyBindingKey(apiKeyId));
      await this.store.zrem(key, apiKeyId);
    }

    return apiKeyIds;
  }

  /**
   * The stored request, or null once its key has expired. A blob we wrote that
   * no longer decodes is corruption rather than absence, so it raises under a
   * code that tells the person to ask for the code change again.
   */
  async read(requestId: string): Promise<StoredControlRequest | null> {
    const raw = await this.store.tryGet(controlRequestKey(requestId));
    if (!raw) {
      return null;
    }

    try {
      return storedControlRequestSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new LangyLocalRecordUnreadableError({
        reasons: error instanceof Error ? [error] : [],
      });
    }
  }

  /** Whether an approval spent this request. The mark outlives the request. */
  async wasApproved(requestId: string): Promise<boolean> {
    return (await this.store.tryGet(controlRequestClaimKey(requestId))) !== null;
  }

  /**
   * Spends one request and mints the command line's session key. The key is
   * minted for the request's own project, whatever project the caller's
   * login is on.
   * @throws {LangyLocalRequestInvalidError} unknown, another user's, or spent
   * @throws {LangyLocalRequestExpiredError} the 15 minutes are over
   */
  async approve({
    requestId,
    userId,
    projectId,
  }: {
    requestId: string;
    userId: string;
    /** When given, the request must be this project's. */
    projectId?: string;
  }): Promise<ApprovedControlRequest> {
    const request = await this.requireOwn({ requestId, userId, projectId });
    const claimed = await this.store.setIfAbsent(
      controlRequestClaimKey(requestId),
      userId,
      Math.ceil(this.ttlMs / 1000),
    );
    if (!claimed) {
      throw new LangyLocalRequestInvalidError({ requestId });
    }

    const project = await this.projectOf(request.projectId);
    const minted = await this.mintSessionKey({
      userId: request.userId,
      projectId: request.projectId,
      organizationId: project.organizationId,
    });
    await this.store.set(
      sessionKeyBindingKey(minted.apiKeyId),
      JSON.stringify({
        conversationId: request.conversationId,
        projectId: request.projectId,
        userId: request.userId,
        requestId: request.id,
      } satisfies SessionKeyBinding),
      KEY_BINDING_TTL_SECONDS,
    );
    // The reverse index: the panel disconnects a CONVERSATION, and this is how
    // it finds the keys that control it.
    await this.store.zadd({
      key: conversationKeyBindingsKey(request.conversationId),
      score: this.now() + KEY_BINDING_TTL_SECONDS * 1000,
      member: minted.apiKeyId,
      ttlSeconds: KEY_BINDING_TTL_SECONDS,
    });
    await this.forget(request);
    logger.info(
      { requestId, conversationId: request.conversationId },
      "control request approved, session key minted",
    );

    return {
      request,
      projectSlug: project.slug,
      sessionKey: minted.token,
      apiKeyId: minted.apiKeyId,
    };
  }

  /** Drops a request the developer refused in the terminal. */
  async cancel({
    requestId,
    userId,
    projectId,
  }: {
    requestId: string;
    userId: string;
    /** When given, the request must be this project's. */
    projectId?: string;
  }): Promise<StoredControlRequest> {
    const request = await this.requireOwn({ requestId, userId, projectId });
    await this.forget(request);

    return request;
  }

  /** The request, when it is this caller's and still open. */
  private async requireOwn({
    requestId,
    userId,
    projectId,
  }: {
    requestId: string;
    userId: string;
    projectId?: string;
  }): Promise<StoredControlRequest> {
    const request = await this.read(requestId);
    // A request that belongs to somebody else answers exactly like one that
    // never existed, so the id cannot be used to probe another person's chat.
    if (
      !request ||
      request.userId !== userId ||
      (projectId !== undefined && request.projectId !== projectId)
    ) {
      throw new LangyLocalRequestInvalidError({ requestId });
    }

    if (request.expiresAt <= this.now()) {
      throw new LangyLocalRequestExpiredError({ requestId });
    }

    return request;
  }

  private async forget(request: StoredControlRequest): Promise<void> {
    await this.store.del(controlRequestKey(request.id));
    await this.store.zrem(userRequestsKey(request.userId), request.id);
  }

  /**
   * The project's slug and the organization it belongs to. A row saying
   * otherwise is broken data, so it degrades to unknown error + trace id
   * (ADR-045).
   */
  private async projectOf(projectId: string): Promise<{ slug: string; organizationId: string }> {
    const [slug, organizationId] = await Promise.all([
      this.projects.getSlug(projectId),
      this.projects.getOrganizationId(projectId),
    ]);
    return { slug, organizationId };
  }
}
