import type { IncomingMessage, ServerResponse } from "node:http";

import { RateLimitedError } from "@langwatch/api";
import {
  McpAuthorizationRequiredError,
  McpSessionIdRequiredError,
  McpSessionLimitReachedError,
  McpSessionNotFoundError,
  McpStoreUnavailableError,
} from "@langwatch/hosted-mcp-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { extractSessionIdHeader } from "../rules/mcp-routes.rules.ts";
import type { McpCallerAuthService, McpCallerLookup } from "./mcp-caller-auth.service.ts";
import type { McpHttpService } from "./mcp-http.service.ts";
import {
  MAX_SESSIONS_PER_KEY,
  type McpSessionService,
  type McpStreamableSession,
} from "./mcp-session.service.ts";

/** A caller whose bearer resolved, with the token it presented. */
type McpResolvedCaller = Readonly<{
  token: string;
  caller: Extract<McpCallerLookup, { kind: "resolved" }>;
}>;

const logger = createLogger("langwatch:mcp");

/** Entropy source; never read back by kind. */
const SESSION_KSUID_RESOURCE = "mcpsession";

/** A session this replica can serve: held here, rebuilt from its record, or neither. */
type McpStreamableSessionLookup =
  | Readonly<{ kind: "found"; session: McpStreamableSession }>
  | Readonly<{ kind: "missing" }>;

/** A session request's caller and session, or the answer already sent. */
type McpSessionResolution =
  | Readonly<{ kind: "found"; session: McpStreamableSession } & McpResolvedCaller>
  | Readonly<{ kind: "missing" } & McpResolvedCaller>
  | Readonly<{ kind: "answered" }>;

type McpStreamableCollaborators = Readonly<{
  http: McpHttpService;
  auth: McpCallerAuthService;
  sessions: McpSessionService;
}>;

/**
 * The Streamable HTTP transport at `/mcp` (and `/sse`): open, drive, reopen and close sessions.
 * A bad bearer answers 401, which sends the client to sign in; a session nobody can serve answers
 * 404, which the MCP spec has the client answer with a fresh initialize on the same token.
 */
export class McpStreamableTransportService {
  readonly #collaborators: McpStreamableCollaborators;
  /** One rebuild per session id at a time, so concurrent requests share the same copy. */
  readonly #rebuilds = new Map<string, Promise<McpStreamableSessionLookup>>();

  private constructor(collaborators: McpStreamableCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(collaborators: McpStreamableCollaborators): McpStreamableTransportService {
    return new McpStreamableTransportService(collaborators);
  }

  async handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http } = this.#collaborators;
    const read = await http.readJsonBody(req, res);
    if (read.kind === "answered") return;

    const sessionId = extractSessionIdHeader(req.headers["mcp-session-id"]);
    if (!sessionId) {
      if (isInitializeRequest(read.body)) {
        await this.#openSession({ req, res, body: read.body });
        return;
      }
      await http.sendHandled(res, new McpSessionIdRequiredError());
      return;
    }

    const resolution = await this.#resolveSession({ req, res, sessionId });
    if (resolution.kind === "answered") return;
    if (resolution.kind === "found") {
      await this.#drive({ req, res, sessionId, ...resolution, body: read.body });
      return;
    }
    // A client re-initializing under a lost session's id is served a new session.
    if (isInitializeRequest(read.body)) {
      await this.#openSession({ req, res, body: read.body });
      return;
    }
    await this.#answerMissing({ req, res, caller: resolution.caller });
  }

  async handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = extractSessionIdHeader(req.headers["mcp-session-id"]);
    if (!sessionId) {
      await this.#collaborators.http.sendHandled(res, new McpSessionIdRequiredError());
      return;
    }

    const resolution = await this.#resolveSession({ req, res, sessionId });
    if (resolution.kind === "answered") return;
    if (resolution.kind === "missing") {
      await this.#answerMissing({ req, res, caller: resolution.caller });
      return;
    }
    await this.#drive({ req, res, sessionId, ...resolution });
  }

  /** The client ending its session: the one place a session record is removed. */
  async handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http, sessions } = this.#collaborators;
    const sessionId = extractSessionIdHeader(req.headers["mcp-session-id"]);
    if (!sessionId) {
      await this.#sendSessionNotFound(res);
      return;
    }

    const resolution = await this.#resolveSession({ req, res, sessionId });
    if (resolution.kind === "answered") return;
    const { session } = resolution.kind === "found" ? resolution : { session: undefined };
    if (!session || !sessions.adoptsCaller({ sessionId, session, caller: resolution.caller })) {
      await this.#answerMissing({ req, res, caller: resolution.caller });
      return;
    }

    http.noteLogFields(res, { projectId: session.projectId });
    sessions.streamable.delete(sessionId);
    await session.transport.close();
    await sessions.removeRecord({ sessionId, apiKey: session.apiKey });
    http.sendJson(res, 200, { status: "session closed" });
  }

  /**
   * The bearer first, then the session: held here, or rebuilt from its record for a caller that
   * owns it. Naming someone else's session id rebuilds nothing and reads as missing.
   */
  async #resolveSession(input: {
    req: IncomingMessage;
    res: ServerResponse;
    sessionId: string;
  }): Promise<McpSessionResolution> {
    const { http, auth, sessions } = this.#collaborators;
    const token = auth.extractBearer(input.req);
    if (!token) {
      await http.sendHandled(input.res, new McpAuthorizationRequiredError());
      return { kind: "answered" };
    }
    const caller = await auth.resolveCaller(token);
    if (caller.kind !== "resolved") {
      await auth.answerUnresolved(input.req, input.res, { token, caller });
      return { kind: "answered" };
    }

    const held = sessions.streamable.get(input.sessionId);
    if (held) return { kind: "found", session: held, token, caller };
    try {
      const rebuilt = await this.#rebuildOnce({ sessionId: input.sessionId, caller });
      http.noteLogFields(input.res, {
        sessionOutcome: rebuilt.kind === "found" ? "rebuilt" : "missing",
      });
      return { ...rebuilt, token, caller };
    } catch (err) {
      logger.error({ error: err }, "MCP session recovery failed");
      await http.sendHandled(input.res, new McpStoreUnavailableError());
      return { kind: "answered" };
    }
  }

  /** Joins a rebuild already running for this id; a waiter it did not serve tries its own. */
  async #rebuildOnce(input: {
    sessionId: string;
    caller: McpResolvedCaller["caller"];
  }): Promise<McpStreamableSessionLookup> {
    const running = this.#rebuilds.get(input.sessionId);
    if (running) {
      const shared = await running.catch(() => undefined);
      if (shared?.kind === "found") return shared;
      const held = this.#collaborators.sessions.streamable.get(input.sessionId);
      if (held) return { kind: "found", session: held };
    }
    const rebuild = this.#recover(input);
    this.#rebuilds.set(input.sessionId, rebuild);
    try {
      return await rebuild;
    } finally {
      if (this.#rebuilds.get(input.sessionId) === rebuild) this.#rebuilds.delete(input.sessionId);
    }
  }

  /** Hands the request to the session once the caller proves it may drive it. */
  async #drive(input: {
    req: IncomingMessage;
    res: ServerResponse;
    sessionId: string;
    caller: McpResolvedCaller["caller"];
    session: McpStreamableSession;
    body?: unknown;
  }): Promise<void> {
    const { http, sessions } = this.#collaborators;
    const { session, sessionId, caller } = input;
    if (!sessions.adoptsCaller({ sessionId, session, caller })) {
      await this.#answerMissing({ req: input.req, res: input.res, caller });
      return;
    }

    http.noteLogFields(input.res, { projectId: session.projectId });
    sessions.markActive(session);
    void sessions.touchRecord({ sessionId, apiKey: session.apiKey });
    // nginx buffers a streamed response unless told not to.
    input.res.setHeader("X-Accel-Buffering", "no");
    await sessions.runAs(session.apiKey, () =>
      session.transport.handleRequest(input.req, input.res, input.body),
    );
  }

  /** A new session: an initialize request, from an authenticated caller under the session limit. */
  async #openSession(input: {
    req: IncomingMessage;
    res: ServerResponse;
    body: unknown;
  }): Promise<void> {
    const { http, auth, sessions } = this.#collaborators;
    // Failed auth is counted inside authenticate; here it is only checked.
    if (auth.isAuthFailureBlocked(input.req)) {
      await http.sendHandled(input.res, new RateLimitedError());
      return;
    }

    const authentication = await auth.authenticate(input.req, input.res);
    if (authentication.kind === "answered") return;
    const { apiKey, projectId } = authentication;

    const caller = await auth.resolveOptionalCaller(auth.extractBearer(input.req));
    const userId = caller.kind === "resolved" ? caller.userId : undefined;

    if (await sessions.isAtSessionLimit(apiKey)) {
      await http.sendHandled(
        input.res,
        new McpSessionLimitReachedError({ maxSessions: MAX_SESSIONS_PER_KEY }),
      );
      return;
    }

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => generate(SESSION_KSUID_RESOURCE).toString(),
      onsessioninitialized: async (id) => {
        sessions.streamable.set(id, sessions.openSession({ transport, apiKey, projectId, userId }));
        // The SDK awaits this before it answers with the id, so the record precedes any DELETE.
        await sessions.storeRecord({ sessionId: id, apiKey, projectId, userId });
      },
    });
    transport.onclose = () => this.#forgetLocalCopy(transport);

    http.noteLogFields(input.res, { sessionOutcome: "opened" });
    input.res.setHeader("X-Accel-Buffering", "no");
    await sessions.connectServer({ transport, apiKey, projectId, userId });
    await sessions.runAs(apiKey, () => transport.handleRequest(input.req, input.res, input.body));
  }

  /**
   * Rebuilds a session from its record, for its own key or a refreshed token of the same person
   * and project. WORKAROUND: the SDK transport starts uninitialized, so its inner state is patched
   * to accept the existing session id; checked against @modelcontextprotocol/sdk@1.32.0.
   */
  async #recover(input: {
    sessionId: string;
    caller: McpResolvedCaller["caller"];
  }): Promise<McpStreamableSessionLookup> {
    const { sessions, auth } = this.#collaborators;
    const { sessionId, caller } = input;
    const record = await sessions.getRecordKey({ sessionId });
    if (record.kind === "missing") return { kind: "missing" };
    const sameKey = record.apiKey === caller.apiKey;
    const samePersonAndProject =
      record.userId !== undefined &&
      caller.userId === record.userId &&
      record.projectId !== undefined &&
      caller.projectId === record.projectId;
    if (!sameKey && !samePersonAndProject) return { kind: "missing" };

    const projectId = record.projectId ?? (await auth.projectIdOf(record.apiKey));
    // A record whose key no longer names a live project has nothing to serve.
    if (projectId === undefined) return { kind: "missing" };
    await sessions.backfillRecordProject({ sessionId, record, projectId });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
    const transportFields: Record<string, unknown> = Object(transport);
    const inner = transportFields._webStandardTransport;
    if (typeof inner !== "object" || inner === null) {
      throw new Error(
        "StreamableHTTPServerTransport internal structure changed — " +
          "Redis session recovery unavailable. Update the SDK workaround.",
      );
    }
    Object.assign(inner, { _initialized: true, sessionId });

    // A record written before records carried the person learns it from its own token.
    const userId = record.userId ?? (sameKey ? caller.userId : undefined);
    const session = sessions.openSession({
      transport,
      apiKey: record.apiKey,
      projectId,
      userId,
      expiresAt: record.expiresAt,
    });
    sessions.streamable.set(sessionId, session);
    transport.onclose = () => this.#forgetLocalCopy(transport);

    await sessions.connectServer({ transport, apiKey: record.apiKey, projectId, userId });
    return { kind: "found", session };
  }

  /** Drops this replica's copy of a closed transport; the record is left to its TTL or a DELETE. */
  #forgetLocalCopy(transport: StreamableHTTPServerTransport): void {
    const { sessionId } = transport;
    if (!sessionId) return;
    const { streamable } = this.#collaborators.sessions;
    if (streamable.get(sessionId)?.transport === transport) streamable.delete(sessionId);
  }

  /** 404 for a session this caller cannot reach, unless the credential itself is dead (401). */
  async #answerMissing(input: {
    req: IncomingMessage;
    res: ServerResponse;
    caller: McpResolvedCaller["caller"];
  }): Promise<void> {
    const { auth, http } = this.#collaborators;
    const live = await auth.credentialIsLive(input.caller);
    if (live === "unavailable") {
      await http.sendHandled(input.res, new McpStoreUnavailableError());
      return;
    }
    if (!live) {
      await auth.refuseBearer(input.req, input.res, input.caller.apiKey);
      return;
    }
    await this.#sendSessionNotFound(input.res);
  }

  async #sendSessionNotFound(res: ServerResponse): Promise<void> {
    this.#collaborators.http.noteLogFields(res, { sessionOutcome: "missing" });
    await this.#collaborators.http.sendHandled(res, new McpSessionNotFoundError());
  }
}
