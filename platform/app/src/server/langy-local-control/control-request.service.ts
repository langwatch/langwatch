/**
 * The control request: the one thing that binds a folder to a conversation
 * (ADR-129).
 *
 * The code access card records a request for (conversation, user, project).
 * `langwatch langy --share-control` lists the open requests of the signed-in
 * person and approves one in the terminal. Approving mints a Langy session key
 * scoped to that conversation, and spends the request.
 *
 * Three properties this service owns, and the reasons they are here:
 *
 * - **Only the requesting user ever sees it.** The list read is keyed by
 *   (project, user), and the approve path checks the record's own `userId`
 *   again, so a teammate holding the id cannot spend it.
 * - **Single use.** The claim is a SET NX on a second key, so two approvals
 *   racing each other contend for one key and exactly one mints a credential.
 * - **Fifteen minutes.** The record carries its own expiry as well as the key
 *   TTL, so an expired request refuses with the reason rather than reading as
 *   a request that never existed.
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import { mintLangySessionApiKeyForUser } from "~/server/app-layer/langy/langyApiKey";
import type { AgentStateStore } from "~/server/connected-agents/state-store";
import { CONTROL_REQUEST_TTL_MS, SHARE_CONTROL_COMMAND } from "./constants";
import {
  LangyLocalRequestExpiredError,
  LangyLocalRequestInvalidError,
} from "./errors";
import type { ControlRequest } from "./http";
import {
  controlRequestClaimKey,
  controlRequestKey,
  sessionKeyBindingKey,
  userRequestsKey,
} from "./keys";

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
 * How long the record outlives the request's own fifteen minutes.
 *
 * A developer who approves a minute late should read "that request expired",
 * not "that request is not open for you": the second sentence sends them
 * looking for a mistake they did not make. So the record is kept past its
 * validity and the expiry check answers, rather than the key simply going.
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

export interface ControlRequestServiceOptions {
  store: AgentStateStore;
  prisma: PrismaClient;
  now?: () => number;
  ttlMs?: number;
  /** Injected so a unit test can prove the flow without minting a real key. */
  mintSessionKey?: ControlRequestKeyMinter;
}

export class ControlRequestService {
  private readonly store: AgentStateStore;
  private readonly prisma: PrismaClient;
  private readonly ttlMs: number;
  private readonly mintSessionKey: ControlRequestKeyMinter;
  readonly now: () => number;

  constructor(options: ControlRequestServiceOptions) {
    this.store = options.store;
    this.prisma = options.prisma;
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? CONTROL_REQUEST_TTL_MS;
    this.mintSessionKey =
      options.mintSessionKey ??
      (({ userId, projectId, organizationId }) =>
        mintLangySessionApiKeyForUser({
          prisma: options.prisma,
          userId,
          projectId,
          organizationId,
        }));
  }

  /**
   * Records the request the code access card renders.
   *
   * A conversation holds one open request at a time. The card can be raised
   * again in the same chat, and the developer runs the command minutes later:
   * without this, the terminal lists the same conversation two or three times
   * and the developer has to guess which row is the live one.
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
      if (older.conversationId !== conversationId) continue;
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
   * The caller's own open requests in one project, newest first.
   *
   * Members whose expiry has passed are dropped from the index on the way, so
   * the set does not grow with every card a person left unanswered.
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
      const request = await this.read(id);
      if (!request) continue;
      if (request.userId !== userId || request.projectId !== projectId)
        continue;
      requests.push(request);
    }
    return requests.sort((left, right) => right.createdAt - left.createdAt);
  }

  /** The open request of one conversation, for the card that is waiting on it. */
  async findOpenForConversation({
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
  async readKeyBinding(apiKeyId: string): Promise<SessionKeyBinding | null> {
    const raw = await this.store.get(sessionKeyBindingKey(apiKeyId));
    if (!raw) return null;
    try {
      const parsed = sessionKeyBindingSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Drops the binding, so the key stops answering for the conversation. */
  async revokeKeyBinding(apiKeyId: string): Promise<void> {
    await this.store.del(sessionKeyBindingKey(apiKeyId));
  }

  async read(requestId: string): Promise<StoredControlRequest | null> {
    const raw = await this.store.get(controlRequestKey(requestId));
    if (!raw) return null;
    try {
      const parsed = storedControlRequestSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Spends one request and mints the session key the command line connects
   * with.
   *
   * @throws {LangyLocalRequestInvalidError} unknown, another user's, or spent
   * @throws {LangyLocalRequestExpiredError} the fifteen minutes are over
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
    if (!claimed) throw new LangyLocalRequestInvalidError({ requestId });

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
    const request = await this.read(requestId);
    // A request that belongs to somebody else answers exactly like one that
    // never existed, so the id cannot be used to probe another person's chat.
    if (
      !request ||
      request.userId !== userId ||
      request.projectId !== projectId
    )
      throw new LangyLocalRequestInvalidError({ requestId });
    if (request.expiresAt <= this.now())
      throw new LangyLocalRequestExpiredError({ requestId });
    return request;
  }

  private async forget(request: StoredControlRequest): Promise<void> {
    await this.store.del(controlRequestKey(request.id));
    await this.store.zrem(
      userRequestsKey(request.projectId, request.userId),
      request.id,
    );
  }

  /**
   * The organization the project belongs to. A project always has a team, and
   * a team an organization; a row that says otherwise is broken data the
   * caller can do nothing about, so it degrades to an unknown error with a
   * trace id rather than a cause we cannot name (ADR-045).
   */
  private async organizationOf(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = project?.team?.organizationId;
    if (!organizationId) {
      throw new Error(`Project ${projectId} resolves to no organization`);
    }
    return organizationId;
  }
}

/** The wire shape of one request, as the command line lists it. */
export function toControlRequestWire(
  request: StoredControlRequest,
): ControlRequest {
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
