import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { getConfig, runWithConfig } from "@langwatch/mcp-server/config";
import { createMcpServer } from "@langwatch/mcp-server/create-mcp-server";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { McpSessionRelayRepository } from "../repositories/mcp-session-relay.repository.ts";
import type {
  McpSessionRecordLookup,
  McpSessionRepository,
  McpSessionTransport,
} from "../repositories/mcp-session.repository.ts";
import type { McpCallerLookup } from "./mcp-caller-auth.service.ts";

const logger = createLogger("langwatch:mcp");

/** Local transports idle this long are closed; their records expire by TTL. */
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** Max concurrent sessions per API key, across both transports and every replica. */
export const MAX_SESSIONS_PER_KEY = 20;

/**
 * One open session. `userId` is the OAuth-flowing person when the bearer was minted by the
 * authorize flow; governance tools attribute audit rows and enforce RBAC with it. `projectId`
 * is the tenant its access log lines carry.
 */
export type McpOpenSession<T> = {
  transport: T;
  apiKey: string;
  projectId: string | undefined;
  userId: string | undefined;
  lastActivityAt: number;
};

export type McpStreamableSession = McpOpenSession<StreamableHTTPServerTransport>;
export type McpSseSession = McpOpenSession<SSEServerTransport>;

type McpSessionCollaborators = Readonly<{
  records: McpSessionRepository;
  relay: McpSessionRelayRepository;
  sessionTools: Pick<GovernanceRestApi, "registerMcpTools"> | undefined;
}>;

/**
 * The sessions this replica holds, and the records that let every other replica find, count and
 * reach them. Record writes are best-effort: a session keeps working until its record's TTL.
 */
export class McpSessionService {
  readonly #collaborators: McpSessionCollaborators;
  /** Maps, not objects: the session id comes from user input. */
  readonly streamable = new Map<string, McpStreamableSession>();
  readonly sse = new Map<string, McpSseSession>();

  private constructor(collaborators: McpSessionCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(collaborators: McpSessionCollaborators): McpSessionService {
    return new McpSessionService(collaborators);
  }

  openSession<T>(input: {
    transport: T;
    apiKey: string;
    projectId: string | undefined;
    userId: string | undefined;
  }): McpOpenSession<T> {
    return { ...input, lastActivityAt: nowInstant().epochMilliseconds };
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
    transport: McpSessionTransport;
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
    void this.removeRecord({
      transport: input.transport,
      sessionId: input.sessionId,
      apiKey: previous,
    })
      .then(() =>
        this.storeRecord({
          transport: input.transport,
          sessionId: input.sessionId,
          apiKey: caller.apiKey,
          projectId,
        }),
      )
      .catch((err: unknown) => {
        logger.error({ error: err }, "Failed to move an MCP session record to its refreshed token");
      });
    return true;
  }

  markActive(session: { lastActivityAt: number }): void {
    session.lastActivityAt = nowInstant().epochMilliseconds;
  }

  async storeRecord(input: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey: string;
    projectId: string;
  }): Promise<void> {
    await this.#collaborators.records.store(input);
  }

  /** Streamable records are written in the background; a failure is logged, never raised. */
  storeStreamableRecord(input: { sessionId: string; apiKey: string; projectId: string }): void {
    this.storeRecord({ transport: "streamable", ...input }).catch((err: unknown) => {
      logger.error({ error: err }, "Failed to store session in Redis");
    });
  }

  touchRecord(input: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey: string;
  }): Promise<void> {
    return this.#collaborators.records.touch(input).catch(() => undefined);
  }

  removeRecord(input: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey?: string;
  }): Promise<void> {
    return this.#collaborators.records.remove(input).catch(() => undefined);
  }

  /** Older replicas wrote no project: the first reader that resolves one writes it back. */
  async backfillRecordProject(input: {
    transport: McpSessionTransport;
    sessionId: string;
    record: Readonly<{ apiKey: string; projectId: string | undefined }>;
    projectId: string | undefined;
  }): Promise<void> {
    const { record, projectId } = input;
    if (record.projectId || !projectId) return;
    await this.storeRecord({
      transport: input.transport,
      sessionId: input.sessionId,
      apiKey: record.apiKey,
      projectId,
    }).catch(() => undefined);
  }

  /** A record that cannot be read or decrypted reads as missing, and is logged. */
  async getRecordKey(input: {
    transport: McpSessionTransport;
    sessionId: string;
  }): Promise<McpSessionRecordLookup> {
    try {
      const record = await this.#collaborators.records.getRecord(input);
      if (record.kind === "missing") return record;
      return record;
    } catch (err) {
      logger.error({ error: err, transport: input.transport }, "Redis session lookup failed");
      return { kind: "missing" };
    }
  }

  /** Across every replica; with no shared store, this replica's own count. Fails open at zero. */
  async countForKey(apiKey: string): Promise<number> {
    if (!this.#collaborators.records.isAvailable()) return this.#countLocal(apiKey);
    try {
      return await this.#collaborators.records.countLive({ apiKey });
    } catch (err) {
      logger.error({ error: err }, "Redis session count failed");
      return 0;
    }
  }

  async isAtSessionLimit(apiKey: string): Promise<boolean> {
    return (await this.countForKey(apiKey)) >= MAX_SESSIONS_PER_KEY;
  }

  listenForRelayed(input: { sessionId: string; onMessage: (raw: string) => void }): Promise<void> {
    return this.#collaborators.relay.listen(input);
  }

  relay(input: { sessionId: string; message: string }): Promise<number> {
    return this.#collaborators.relay.publish(input);
  }

  /** Drops every trace of an SSE session: the local entry, its relay subscription, its record. */
  async releaseSse(sessionId: string, apiKey: string): Promise<void> {
    this.sse.delete(sessionId);
    await this.#collaborators.relay.stopListening({ sessionId });
    await this.removeRecord({ transport: "sse", sessionId, apiKey });
  }

  /** Closes idle local transports; the SSE ones take their record and relay subscription along. */
  reapIdle(now: number): void {
    for (const [id, session] of this.streamable) {
      if (now - session.lastActivityAt > SESSION_MAX_AGE_MS) {
        session.transport.close().catch(() => undefined);
        this.streamable.delete(id);
        void this.removeRecord({ transport: "streamable", sessionId: id, apiKey: session.apiKey });
      }
    }
    for (const [id, session] of this.sse) {
      if (now - session.lastActivityAt > SESSION_MAX_AGE_MS) {
        session.transport.close().catch(() => undefined);
        this.releaseSse(id, session.apiKey).catch(() => undefined);
      }
    }
  }

  /**
   * Resolves once every SSE record this replica owns is released: a released record frees a slot
   * against the per-key limit, and exiting without waiting leaves it allocated until its TTL.
   */
  async closeAll(): Promise<void> {
    for (const [id, session] of this.streamable) {
      session.transport.close().catch(() => undefined);
      this.streamable.delete(id);
    }
    const released: Promise<void>[] = [];
    for (const [id, session] of this.sse) {
      session.transport.close().catch(() => undefined);
      released.push(this.releaseSse(id, session.apiKey).catch(() => undefined));
    }
    await Promise.all(released);
    this.#collaborators.relay.close();
  }

  #countLocal(apiKey: string): number {
    let count = 0;
    for (const session of [...this.streamable.values(), ...this.sse.values()]) {
      if (session.apiKey === apiKey) count++;
    }
    return count;
  }
}
