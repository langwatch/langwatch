/**
 * The control request binding a folder to a conversation (ADR-129). Owns
 * three properties: user-scoped visibility, single-use (SET NX), and a
 * 15-minute self-carried expiry.
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AgentStateStorePort } from "@langwatch/agent-contract";
import {
  CONTROL_REQUEST_TTL_MS,
  SHARE_CONTROL_COMMAND,
  type ControlRequest,
} from "@langwatch/langy-contract";
import {
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
  sessionKey: string;
  apiKeyId: string;
}

/** The one mint this service makes, as a type, so a test needs no database. */
export type ControlRequestKeyMinter = (args: {
  userId: string;
  projectId: string;
  organizationId: string;
}) => Promise<{ token: string; apiKeyId: string }>;

/** The one project fact this service reads: which organization owns it. */
export type ControlRequestProjects = Readonly<{
  tryReadOrganizationId(projectId: string): Promise<string | null>;
}>;

export interface ControlRequestServiceOptions {
  store: AgentStateStorePort;
  projects: ControlRequestProjects;
  /** Mints the per-conversation session key the command line authenticates with. */
  mintSessionKey: ControlRequestKeyMinter;
  now?: () => number;
  ttlMs?: number;
}

export class ControlRequestService {
  private readonly store: AgentStateStorePort;
  private readonly projects: ControlRequestProjects;
  private readonly ttlMs: number;
  private readonly mintSessionKey: ControlRequestKeyMinter;
  readonly now: () => number;

  static create(options: ControlRequestServiceOptions): ControlRequestService {
    return new ControlRequestService(options);
  }

  /**
   * The wire shape of one request, as the command line lists it.
   *
   * A static method (not a `rules/` function) because it constructs a
   * `Date` to format the stored epoch millis as ISO strings — a rules
   * module may not construct one even for a pure formatting use.
   */
  static toWire(request: StoredControlRequest): ControlRequest {
    return {
      id: request.id,
      conversationId: request.conversationId,
      conversationTitle: request.conversationTitle,
      conversationUrl: request.conversationUrl,
      projectId: request.projectId,
      projectName: request.projectName,
      createdAt: new Date(request.createdAt).toISOString(),
      expiresAt: new Date(request.expiresAt).toISOString(),
    };
  }

  private constructor(options: ControlRequestServiceOptions) {
    this.store = options.store;
    this.projects = options.projects;
    this.now = options.now ?? (() => Date.now());
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
      key: userRequestsKey(projectId, userId),
      score: request.expiresAt,
      member: request.id,
      ttlSeconds: Math.ceil((this.ttlMs + RECORD_GRACE_MS) / 1000),
    });

    return request;
  }

  /**
   * The caller's own open requests in one project, newest first. Expired
   * members are dropped from the index on the way.
   */
  async listOpen({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<StoredControlRequest[]> {
    const key = userRequestsKey(projectId, userId);
    const now = this.now();
    await this.store.zremrangebyscore(key, now);
    const ids = await this.store.zrangebyscore(key, now);
    const requests: StoredControlRequest[] = [];
    for (const id of ids) {
      const request = await this.tryRead(id);
      if (!request) {
        continue;
      }

      if (request.userId !== userId || request.projectId !== projectId) {
        continue;
      }

      requests.push(request);
    }

    return requests.sort((left, right) => right.createdAt - left.createdAt);
  }

  /** The open request of one conversation, for the card that is waiting on it. */
  async tryFindOpenForConversation({
    projectId,
    userId,
    conversationId,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
  }): Promise<StoredControlRequest | null> {
    const open = await this.listOpen({ projectId, userId });

    return open.find((row) => row.conversationId === conversationId) ?? null;
  }

  /** The conversation one minted key controls, or nothing when it controls none. */
  async tryReadKeyBinding(apiKeyId: string): Promise<SessionKeyBinding | null> {
    const raw = await this.store.tryGet(sessionKeyBindingKey(apiKeyId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = sessionKeyBindingSchema.safeParse(JSON.parse(raw));

      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Drops the binding, so the key stops answering for the conversation. */
  async revokeKeyBinding(apiKeyId: string): Promise<void> {
    const binding = await this.tryReadKeyBinding(apiKeyId);
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

  async tryRead(requestId: string): Promise<StoredControlRequest | null> {
    const raw = await this.store.tryGet(controlRequestKey(requestId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = storedControlRequestSchema.safeParse(JSON.parse(raw));

      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Spends one request and mints the command line's session key.
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
    projectId: string;
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

    const organizationId = await this.organizationOf(request.projectId);
    const minted = await this.mintSessionKey({
      userId: request.userId,
      projectId: request.projectId,
      organizationId,
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

    return { request, sessionKey: minted.token, apiKeyId: minted.apiKeyId };
  }

  /** Drops a request the developer refused in the terminal. */
  async cancel({
    requestId,
    userId,
    projectId,
  }: {
    requestId: string;
    userId: string;
    projectId: string;
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
    projectId: string;
  }): Promise<StoredControlRequest> {
    const request = await this.tryRead(requestId);
    // A request that belongs to somebody else answers exactly like one that
    // never existed, so the id cannot be used to probe another person's chat.
    if (!request || request.userId !== userId || request.projectId !== projectId) {
      throw new LangyLocalRequestInvalidError({ requestId });
    }

    if (request.expiresAt <= this.now()) {
      throw new LangyLocalRequestExpiredError({ requestId });
    }

    return request;
  }

  private async forget(request: StoredControlRequest): Promise<void> {
    await this.store.del(controlRequestKey(request.id));
    await this.store.zrem(userRequestsKey(request.projectId, request.userId), request.id);
  }

  /**
   * The organization the project belongs to. A row saying otherwise is
   * broken data, so it degrades to unknown error + trace id (ADR-045).
   */
  private async organizationOf(projectId: string): Promise<string> {
    const organizationId = await this.projects.tryReadOrganizationId(projectId);
    if (!organizationId) {
      throw new Error(`Project ${projectId} resolves to no organization`);
    }

    return organizationId;
  }
}
