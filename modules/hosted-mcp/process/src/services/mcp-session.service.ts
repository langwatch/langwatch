import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { getConfig, runWithConfig } from "@langwatch/mcp-server/config";
import { createMcpServer } from "@langwatch/mcp-server/create-mcp-server";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type {
  McpSessionRecordLookup,
  McpSessionRepository,
} from "../repositories/mcp-session.repository.ts";
import type { McpCallerLookup } from "./mcp-caller-auth.service.ts";

const logger = createLogger("langwatch:mcp");

/**
 * A local transport idle this long is closed to free memory; its record stays, so the session's
 * next request rebuilds it here or on any replica. Also the window a session counts as active.
 */
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** A session lasts this long from when it opened; use never extends it. */
const SESSION_LIFETIME_MS = 30 * 24 * 3600 * 1000;

/** An SSE comment line, which clients ignore and idle-timing proxies count as traffic. */
const KEEPALIVE_COMMENT = ": keepalive\n\n";

/** Max concurrent sessions per API key, across every replica. */
export const MAX_SESSIONS_PER_KEY = 20;

/**
 * One open session. `userId` is the OAuth-flowing person when the bearer was minted by the
 * authorize flow; governance tools attribute audit rows and enforce RBAC with it. `projectId`
 * is the tenant its access log lines carry.
 */
type McpOpenSession<T> = {
  transport: T;
  apiKey: string;
  projectId: string | undefined;
  userId: string | undefined;
  lastActivityAt: number;
  /** When the session ends (epoch ms); a copy past it is dropped and its next request 404s. */
  expiresAt: number;
};

export type McpStreamableSession = McpOpenSession<StreamableHTTPServerTransport>;

type McpSessionCollaborators = Readonly<{
  records: McpSessionRepository;
  sessionTools: Pick<GovernanceRestApi, "registerMcpTools"> | undefined;
}>;

/**
 * The sessions this replica holds, and the records that let every other replica find, count and
 * reach them. Record writes are best-effort. Only the client's DELETE removes a record.
 */
export class McpSessionService {
  readonly #collaborators: McpSessionCollaborators;
  /** Maps, not objects: the session id comes from user input. */
  readonly streamable = new Map<string, McpStreamableSession>();

  private constructor(collaborators: McpSessionCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(collaborators: McpSessionCollaborators): McpSessionService {
    return new McpSessionService(collaborators);
  }

  /** A new session ends 30 days from now; one rebuilt from its record keeps the record's end. */
  openSession<T>(input: {
    transport: T;
    apiKey: string;
    projectId: string | undefined;
    userId: string | undefined;
    expiresAt?: number;
  }): McpOpenSession<T> {
    const now = nowInstant().epochMilliseconds;
    return {
      ...input,
      lastActivityAt: now,
      expiresAt: input.expiresAt ?? now + SESSION_LIFETIME_MS,
    };
  }

  /** Runs `work` with the MCP server configured for this session's key. */
  runAs<T>(apiKey: string, work: () => Promise<T>): Promise<T> {
    const baseConfig = getConfig();
    logger.debug(
      { hasApiKey: !!apiKey, endpoint: baseConfig.endpoint },
      "Running with session config",
    );
    return runWithConfig({ ...baseConfig, apiKey }, work);
  }

  /** A fresh MCP server for one session, with the composing process's extra tools installed. */
  async connectServer(input: {
    transport: Transport;
    apiKey: string;
    projectId: string;
    userId: string | undefined;
  }): Promise<void> {
    const server = createMcpServer();
    this.#collaborators.sessionTools?.registerMcpTools({
      server,
      projectId: input.projectId,
      callerUserId: input.userId,
    });
    await this.runAs(input.apiKey, () => server.connect(input.transport));
  }

  /**
   * Whether this caller may drive the session: its own bearer, or a refreshed access token for the
   * same person and project, which the session adopts so a client's hourly refresh keeps it.
   */
  adoptsCaller<T>(input: {
    sessionId: string;
    session: McpOpenSession<T>;
    caller: McpCallerLookup;
  }): boolean {
    const { session, caller } = input;
    if (caller.kind !== "resolved") return false;
    if (caller.apiKey === session.apiKey) return true;
    const projectId = session.projectId;
    const samePersonAndProject =
      caller.userId !== undefined &&
      caller.userId === session.userId &&
      projectId !== undefined &&
      caller.projectId === projectId;
    if (!samePersonAndProject) return false;

    const previous = session.apiKey;
    session.apiKey = caller.apiKey;
    // Written under the new token before the old one stops counting, so no failure loses it.
    void this.#collaborators.records
      .rewrite({
        sessionId: input.sessionId,
        apiKey: caller.apiKey,
        projectId,
        userId: session.userId,
      })
      .then(() =>
        this.#collaborators.records.forgetKey({ sessionId: input.sessionId, apiKey: previous }),
      )
      .catch((err: unknown) => {
        logger.error({ error: err }, "Failed to move an MCP session record to its refreshed token");
      });
    return true;
  }

  markActive(session: { lastActivityAt: number }): void {
    session.lastActivityAt = nowInstant().epochMilliseconds;
  }

  /**
   * Awaited before the client learns the session id, so its DELETE always lands after this write.
   * A failure is logged, never raised: the session still serves from the replica that opened it.
   */
  async storeRecord(input: {
    sessionId: string;
    apiKey: string;
    projectId: string;
    userId: string | undefined;
  }): Promise<void> {
    await this.#collaborators.records.store(input).catch((err: unknown) => {
      logger.error({ error: err }, "Failed to store session in Redis");
    });
  }

  touchRecord(input: { sessionId: string; apiKey: string }): Promise<void> {
    return this.#collaborators.records.touch(input).catch(() => undefined);
  }

  /** Ends the session everywhere; only the client's own DELETE calls this. */
  removeRecord(input: { sessionId: string; apiKey?: string }): Promise<void> {
    return this.#collaborators.records.remove(input).catch(() => undefined);
  }

  /** Older replicas wrote no project: the first reader that resolves one writes it back. */
  async backfillRecordProject(input: {
    sessionId: string;
    record: Readonly<{ apiKey: string; projectId: string | undefined; userId: string | undefined }>;
    projectId: string | undefined;
  }): Promise<void> {
    const { record, projectId } = input;
    if (record.projectId || !projectId) return;
    await this.#collaborators.records
      .rewrite({
        sessionId: input.sessionId,
        apiKey: record.apiKey,
        projectId,
        userId: record.userId,
      })
      .catch(() => undefined);
  }

  /** A record that cannot be read or decrypted reads as missing, and is logged. */
  async getRecordKey(input: { sessionId: string }): Promise<McpSessionRecordLookup> {
    try {
      return await this.#collaborators.records.getRecord(input);
    } catch (err) {
      logger.error({ error: err }, "Redis session lookup failed");
      return { kind: "missing" };
    }
  }

  /**
   * Sessions active in the last {@link SESSION_MAX_AGE_MS}, across every replica; with no shared
   * store, this replica's own count. Fails open at zero.
   */
  async countForKey(apiKey: string): Promise<number> {
    if (!this.#collaborators.records.isAvailable()) return this.#countLocal(apiKey);
    try {
      const since = nowInstant().epochMilliseconds - SESSION_MAX_AGE_MS;
      return await this.#collaborators.records.countActive({ apiKey, since });
    } catch (err) {
      logger.error({ error: err }, "Redis session count failed");
      return 0;
    }
  }

  async isAtSessionLimit(apiKey: string): Promise<boolean> {
    return (await this.countForKey(apiKey)) >= MAX_SESSIONS_PER_KEY;
  }

  /**
   * Closes idle local transports, whose records stay so each session can be rebuilt, and ended
   * ones, whose records Redis expires at the same moment.
   */
  reapIdle(now: number): void {
    for (const [id, session] of this.streamable) {
      const idle = now - session.lastActivityAt > SESSION_MAX_AGE_MS;
      if (idle || now >= session.expiresAt) this.#dropLocal(id, session);
    }
  }

  /** Drops this replica's copies at shutdown; the records stay for the replica that takes over. */
  closeAll(): Promise<void> {
    for (const [id, session] of this.streamable) this.#dropLocal(id, session);
    return Promise.resolve();
  }

  /**
   * Writes a comment on every open stream so idle-timing proxies keep it. A session with an open
   * stream is active: it is not reaped as idle and keeps counting against its key's session limit.
   */
  pingOpenStreams(): void {
    for (const [sessionId, session] of this.streamable) {
      if (writeToOpenStreams(session.transport, KEEPALIVE_COMMENT) === 0) continue;
      this.markActive(session);
      void this.touchRecord({ sessionId, apiKey: session.apiKey });
    }
  }

  #dropLocal(id: string, session: McpStreamableSession): void {
    this.streamable.delete(id);
    session.transport.close().catch(() => undefined);
  }

  #countLocal(apiKey: string): number {
    let count = 0;
    for (const session of this.streamable.values()) {
      if (session.apiKey === apiKey) count++;
    }
    return count;
  }
}

/**
 * Enqueues `text` on each stream the transport holds open, answering how many took it.
 * WORKAROUND: the SDK keeps its stream controllers private; checked against
 * @modelcontextprotocol/sdk@1.31.0, and a changed shape writes nothing rather than throwing.
 */
function writeToOpenStreams(transport: StreamableHTTPServerTransport, text: string): number {
  const transportFields: Record<string, unknown> = Object(transport);
  const innerFields: Record<string, unknown> = Object(transportFields._webStandardTransport);
  const streams = innerFields._streamMapping;
  if (!(streams instanceof Map)) return 0;
  let written = 0;
  for (const stream of streams.values()) {
    const { controller, encoder }: Record<string, unknown> = Object(stream);
    if (!(controller instanceof ReadableStreamDefaultController)) continue;
    if (!(encoder instanceof TextEncoder)) continue;
    try {
      controller.enqueue(encoder.encode(text));
      written++;
    } catch {
      // A stream closing under us is about to leave the map.
    }
  }
  return written;
}
