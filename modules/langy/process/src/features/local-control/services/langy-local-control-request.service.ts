/**
 * The control request binding a folder to a conversation (ADR-129). Owns
 * three properties: user-scoped visibility, single-use (SET NX), and a
 * 15-minute self-carried expiry.
 */

import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { Temporal, nowInstant } from "@langwatch/time";

/** The stored epoch millis as the ISO string the wire has always carried. */
function isoOf(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toString({ fractionalSecondDigits: 3 });
}
import {
  CONTROL_REQUEST_TTL_MS,
  SHARE_CONTROL_COMMAND,
  type ControlRequest,
  LangyLocalRecordNotFoundError,
  LangyLocalRecordUnreadableError,
  LangyLocalRequestExpiredError,
  LangyLocalRequestInvalidError,
} from "@langwatch/langy-contract";

import { LANGY_ID_RESOURCES } from "../../../eventing/langy-conversation-process.schemas.ts";
import type { LocalRecordLookup } from "../../../repositories/langy-local-call.repository.ts";
import type {
  LangyLocalControlRequestRepository,
  SessionKeyBinding,
  StoredControlRequest,
} from "../../../repositories/langy-local-control-request.repository.ts";

const logger = createLogger("langwatch:langy:local-control:requests");

/** How long a minted session key may control its conversation. */
const KEY_BINDING_TTL_SECONDS = 6 * 60 * 60;

/**
 * How long the record outlives the request's own 15 minutes, so a late
 * approval reads "that request expired" rather than "not found".
 */
const RECORD_GRACE_MS = 30 * 60 * 1000;

/** What approving one request hands back to the command line. */
interface ApprovedControlRequest {
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

interface ControlRequestServiceOptions {
  requests: LangyLocalControlRequestRepository;
  projects: ControlRequestProjects;
  /** Mints the per-conversation session key the command line authenticates with. */
  mintSessionKey: ControlRequestKeyMinter;
  now?: () => number;
  ttlMs?: number;
}

export class ControlRequestService {
  private readonly requests: LangyLocalControlRequestRepository;
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
    this.requests = options.requests;
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
      id: generate(LANGY_ID_RESOURCES.controlRequest).toString(),
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
    await this.requests.saveRequest({
      request,
      ttlSeconds: Math.ceil((this.ttlMs + RECORD_GRACE_MS) / 1000),
    });
    // The index is scored by expiry, so the list read drops a request that is
    // over even while the record it points at is still there to explain why.
    await this.requests.indexOpenRequest({
      userId,
      requestId: request.id,
      expiresAt: request.expiresAt,
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
    const now = this.now();
    await this.requests.dropLapsedRequests({ userId, lapsedAt: now });
    const ids = await this.requests.findOpenRequestIds({ userId, from: now });
    const requests: StoredControlRequest[] = [];
    for (const id of ids) {
      let request: StoredControlRequest;
      try {
        request = await this.getRequest(id);
      } catch (error) {
        if (HandledError.isHandled(error) && error.code === "langy_local_record_not_found") {
          continue;
        }
        if (!(error instanceof LangyLocalRecordUnreadableError)) {
          throw error;
        }

        logger.warn({ requestId: id }, "skipping unreadable control request");
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
   * The conversation one minted key controls; `langy_local_record_not_found` when it
   * controls none. A binding we wrote that no longer decodes is corruption, so it
   * raises under a code rather than reading back as a key that controls nothing.
   */
  async getKeyBinding(apiKeyId: string): Promise<SessionKeyBinding> {
    return found(await this.requests.findKeyBinding(apiKeyId));
  }

  /** Drops the binding, so the key stops answering for the conversation. */
  async revokeKeyBinding(apiKeyId: string): Promise<void> {
    const binding = await this.getKeyBinding(apiKeyId).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "langy_local_record_not_found") {
        return null;
      }
      throw error;
    });
    await this.requests.deleteKeyBinding(apiKeyId);
    if (binding) {
      await this.requests.unindexKeyBinding({ conversationId: binding.conversationId, apiKeyId });
    }
  }

  /**
   * Drops every binding for one conversation. Never reads presence — revoking
   * holds whether or not a socket is still there to be told about it.
   * @returns the keys that were revoked
   */
  async revokeConversationBindings(conversationId: string): Promise<string[]> {
    const apiKeyIds = await this.requests.findKeyBindingIds(conversationId);
    for (const apiKeyId of apiKeyIds) {
      await this.requests.deleteKeyBinding(apiKeyId);
      await this.requests.unindexKeyBinding({ conversationId, apiKeyId });
    }

    return apiKeyIds;
  }

  /**
   * The stored request; `langy_local_record_not_found` once its key has expired. A
   * blob we wrote that no longer decodes is corruption rather than absence, so it
   * raises under a code that tells the person to ask for the code change again.
   */
  async getRequest(requestId: string): Promise<StoredControlRequest> {
    return found(await this.requests.findRequest(requestId));
  }

  /** Whether an approval spent this request. The mark outlives the request. */
  async wasApproved(requestId: string): Promise<boolean> {
    return this.requests.isClaimed(requestId);
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
    const claimed = await this.requests.claimRequest({
      requestId,
      userId,
      ttlSeconds: Math.ceil(this.ttlMs / 1000),
    });
    if (!claimed) {
      throw new LangyLocalRequestInvalidError({ requestId });
    }

    const project = await this.projectOf(request.projectId);
    const minted = await this.mintSessionKey({
      userId: request.userId,
      projectId: request.projectId,
      organizationId: project.organizationId,
    });
    await this.requests.saveKeyBinding({
      apiKeyId: minted.apiKeyId,
      binding: {
        conversationId: request.conversationId,
        projectId: request.projectId,
        userId: request.userId,
        requestId: request.id,
      },
      ttlSeconds: KEY_BINDING_TTL_SECONDS,
    });
    // The reverse index: the panel disconnects a CONVERSATION, and this is how
    // it finds the keys that control it.
    await this.requests.indexKeyBinding({
      conversationId: request.conversationId,
      apiKeyId: minted.apiKeyId,
      lapsesAt: this.now() + KEY_BINDING_TTL_SECONDS * 1000,
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
    const request = await this.getRequest(requestId).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "langy_local_record_not_found") {
        throw new LangyLocalRequestInvalidError({ requestId });
      }
      throw error;
    });
    // A request that belongs to somebody else answers exactly like one that
    // never existed, so the id cannot be used to probe another person's chat.
    if (request.userId !== userId || (projectId !== undefined && request.projectId !== projectId)) {
      throw new LangyLocalRequestInvalidError({ requestId });
    }

    if (request.expiresAt <= this.now()) {
      throw new LangyLocalRequestExpiredError({ requestId });
    }

    return request;
  }

  private async forget(request: StoredControlRequest): Promise<void> {
    await this.requests.forgetRequest({ requestId: request.id, userId: request.userId });
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

/**
 * The stored record; `langy_local_record_not_found` when absent, and the unreadable
 * code when a record we wrote no longer decodes.
 */
function found<T>(lookup: LocalRecordLookup<T>): T {
  if (lookup.kind === "miss") {
    throw new LangyLocalRecordNotFoundError();
  }
  if (lookup.kind === "unreadable") {
    throw new LangyLocalRecordUnreadableError({ reasons: lookup.reasons });
  }

  return lookup.value;
}
