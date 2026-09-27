import type { IncomingMessage, ServerResponse } from "node:http";

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { extractSessionIdHeader } from "../rules/mcp-routes.rules.ts";
import type { McpCallerAuthService } from "./mcp-caller-auth.service.ts";
import type { McpHttpService } from "./mcp-http.service.ts";
import {
  MAX_SESSIONS_PER_KEY,
  type McpSessionService,
  type McpStreamableSession,
} from "./mcp-session.service.ts";

const logger = createLogger("langwatch:mcp");

/** Entropy source; never read back by kind. */
const SESSION_KSUID_RESOURCE = "mcpsession";

/** A session this replica can serve: held here, rebuilt from its record, or neither. */
type McpStreamableSessionLookup =
  | Readonly<{ kind: "found"; session: McpStreamableSession }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "answered" }>;

type McpStreamableCollaborators = Readonly<{
  http: McpHttpService;
  auth: McpCallerAuthService;
  sessions: McpSessionService;
}>;

/** The Streamable HTTP transport at `/mcp`: open, drive, reopen and close sessions. */
export class McpStreamableTransportService {
  readonly #collaborators: McpStreamableCollaborators;

  private constructor(collaborators: McpStreamableCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(collaborators: McpStreamableCollaborators): McpStreamableTransportService {
    return new McpStreamableTransportService(collaborators);
  }

  async handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http, sessions } = this.#collaborators;
    const read = await http.readJsonBody(req, res);
    if (read.kind === "answered") return;

    const sessionId = extractSessionIdHeader(req.headers["mcp-session-id"]);
    if (sessionId) {
      const served = await this.#serveExisting({ req, res, sessionId, body: read.body });
      if (served) return;
    }

    if ((!sessionId || !sessions.streamable.has(sessionId)) && isInitializeRequest(read.body)) {
      await this.#openSession({ req, res, body: read.body });
      return;
    }

    // An id nobody holds has expired: a 401 with WWW-Authenticate makes OAuth clients sign in.
    if (sessionId) {
      http.send401(res, "Session expired or not found");
      return;
    }
    http.sendJson(res, 400, {
      error: "Invalid request — no session ID or not an initialize request",
    });
  }

  async handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http } = this.#collaborators;
    const sessionId = extractSessionIdHeader(req.headers["mcp-session-id"]);
    if (!sessionId) {
      http.sendJson(res, 400, { error: "Invalid request — no valid session ID" });
      return;
    }

    const token = this.#collaborators.auth.extractBearer(req);
    const caller = await this.#collaborators.auth.resolveOptionalCaller(token);
    const callerApiKey = caller.kind === "resolved" ? caller.apiKey : undefined;
    const lookup = await this.#findSession({ res, sessionId, token, callerApiKey });
    if (lookup.kind === "answered") return;
    if (lookup.kind === "missing") {
      // A caller that presented nothing is told so; one whose token belongs elsewhere is told the
      // session is gone, the answer that confirms nothing about it.
      http.send401(res, token ? "Session expired or not found" : "Authorization header required");
      return;
    }

    await this.#drive({ req, res, sessionId, token, callerApiKey, session: lookup.session });
  }

  async handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http, auth, sessions } = this.#collaborators;
    const sessionId = extractSessionIdHeader(req.headers["mcp-session-id"]);
    const session = sessionId ? sessions.streamable.get(sessionId) : undefined;
    if (!sessionId || !session) {
      http.sendJson(res, 404, { error: "Session not found" });
      return;
    }

    const token = auth.extractBearer(req);
    if (!token) {
      http.send401(res, "Authorization header required");
      return;
    }
    const caller = await auth.resolveCaller(token);
    if (caller.kind !== "resolved" || caller.apiKey !== session.apiKey) {
      http.send401(
        res,
        auth.isGrantRevoked(token) ? "mcp_grant_revoked" : "Bearer token does not match session",
      );
      return;
    }

    await session.transport.close();
    sessions.streamable.delete(sessionId);
    void sessions.removeRecord({ transport: "streamable", sessionId, apiKey: session.apiKey });
    http.sendJson(res, 200, { status: "session closed" });
  }

  /** Whether the post belonged to a session this replica holds or rebuilt, and was answered. */
  async #serveExisting(input: {
    req: IncomingMessage;
    res: ServerResponse;
    sessionId: string;
    body: unknown;
  }): Promise<boolean> {
    const token = this.#collaborators.auth.extractBearer(input.req);
    const caller = await this.#collaborators.auth.resolveOptionalCaller(token);
    const callerApiKey = caller.kind === "resolved" ? caller.apiKey : undefined;
    const lookup = await this.#findSession({ ...input, token, callerApiKey });
    if (lookup.kind === "answered") return true;
    if (lookup.kind === "missing") return false;
    await this.#drive({ ...input, token, callerApiKey, session: lookup.session });
    return true;
  }

  /**
   * Held here, or rebuilt from another replica's record. Only a caller that already proved it
   * owns the session gets a rebuild, so naming someone else's session id rebuilds nothing.
   */
  async #findSession(input: {
    res: ServerResponse;
    sessionId: string;
    token: string | undefined;
    callerApiKey: string | undefined;
  }): Promise<McpStreamableSessionLookup> {
    const held = this.#collaborators.sessions.streamable.get(input.sessionId);
    if (held) return { kind: "found", session: held };
    if (!input.callerApiKey) return { kind: "missing" };
    try {
      return await this.#recover({
        sessionId: input.sessionId,
        token: input.token,
        callerApiKey: input.callerApiKey,
      });
    } catch (err) {
      logger.error({ error: err }, "MCP session recovery failed");
      this.#collaborators.http.sendJson(input.res, 500, { error: "Internal server error" });
      return { kind: "answered" };
    }
  }

  /** Hands the request to a session its own caller presented, after proving the bearer matches. */
  async #drive(input: {
    req: IncomingMessage;
    res: ServerResponse;
    sessionId: string;
    token: string | undefined;
    callerApiKey: string | undefined;
    session: McpStreamableSession;
    body?: unknown;
  }): Promise<void> {
    const { http, sessions } = this.#collaborators;
    const { session } = input;
    if (!input.token) {
      http.send401(input.res, "Authorization header required");
      return;
    }
    if (input.callerApiKey !== session.apiKey) {
      http.send401(input.res, "Bearer token does not match session");
      return;
    }

    sessions.markActive(session);
    void sessions.touchRecord({
      transport: "streamable",
      sessionId: input.sessionId,
      apiKey: session.apiKey,
    });
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
      http.sendJson(input.res, 429, { error: "Too many requests" });
      return;
    }

    const authentication = await auth.authenticate(input.req, input.res);
    if (authentication.kind === "answered") return;
    const { apiKey } = authentication;

    const caller = await auth.resolveOptionalCaller(auth.extractBearer(input.req));
    const userId = caller.kind === "resolved" ? caller.userId : undefined;

    if (await sessions.isAtSessionLimit(apiKey)) {
      http.sendJson(input.res, 429, {
        error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
      });
      return;
    }

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => generate(SESSION_KSUID_RESOURCE).toString(),
      onsessioninitialized: (id) => {
        sessions.streamable.set(id, sessions.openSession({ transport, apiKey, userId }));
        sessions.storeStreamableRecord(id, apiKey);
      },
    });
    transport.onclose = () => {
      if (!transport.sessionId) return;
      sessions.streamable.delete(transport.sessionId);
      void sessions.removeRecord({
        transport: "streamable",
        sessionId: transport.sessionId,
        apiKey,
      });
    };

    await sessions.connectServer({ transport, apiKey, userId });
    await sessions.runAs(apiKey, () => transport.handleRequest(input.req, input.res, input.body));
  }

  /**
   * Rebuilds a session on this replica from the record another one wrote. WORKAROUND: the SDK
   * transport starts uninitialized, so its inner state is patched to accept the existing session
   * id; checked against @modelcontextprotocol/sdk@1.29.0.
   */
  async #recover(input: {
    sessionId: string;
    token: string | undefined;
    callerApiKey: string;
  }): Promise<McpStreamableSessionLookup> {
    const { sessions, auth } = this.#collaborators;
    const record = await sessions.getRecordKey({
      transport: "streamable",
      sessionId: input.sessionId,
    });
    if (record.kind === "missing" || record.apiKey !== input.callerApiKey)
      return { kind: "missing" };

    const { sessionId } = input;
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

    // The OAuth user is recovered while the token still carries one; a project key has none.
    const caller = await auth.resolveOptionalCaller(input.token);
    const userId = caller.kind === "resolved" ? caller.userId : undefined;
    const session = sessions.openSession({ transport, apiKey: record.apiKey, userId });
    sessions.streamable.set(sessionId, session);
    transport.onclose = () => {
      sessions.streamable.delete(sessionId);
    };

    await sessions.connectServer({ transport, apiKey: record.apiKey, userId });
    return { kind: "found", session };
  }
}
