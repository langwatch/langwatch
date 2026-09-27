import type { IncomingMessage, ServerResponse } from "node:http";

import { createLogger } from "@langwatch/observability";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import type { McpCallerAuthService } from "./mcp-caller-auth.service.ts";
import type { McpHttpService } from "./mcp-http.service.ts";
import {
  MAX_SESSIONS_PER_KEY,
  type McpSessionService,
  type McpSseSession,
} from "./mcp-session.service.ts";

const logger = createLogger("langwatch:mcp");

type McpSseCollaborators = Readonly<{
  http: McpHttpService;
  auth: McpCallerAuthService;
  sessions: McpSessionService;
}>;

/**
 * The SSE transport (ChatGPT and friends): a stream held by one replica, and messages posted to
 * any replica. The load balancer has no session affinity, so most messages of a healthy session
 * arrive where the stream is not, and are relayed to where it is.
 */
export class McpSseTransportService {
  readonly #collaborators: McpSseCollaborators;

  private constructor(collaborators: McpSseCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(collaborators: McpSseCollaborators): McpSseTransportService {
    return new McpSseTransportService(collaborators);
  }

  async handleConnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http, auth, sessions } = this.#collaborators;
    const authentication = await auth.authenticate(req, res);
    if (authentication.kind === "answered") return;
    const { apiKey } = authentication;

    const caller = await auth.resolveOptionalCaller(auth.extractBearer(req));
    const userId = caller.kind === "resolved" ? caller.userId : undefined;

    if (await sessions.isAtSessionLimit(apiKey)) {
      http.sendJson(res, 429, {
        error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
      });
      return;
    }

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    http.noteLogFields(res, { sessionId });

    const session = sessions.openSession({ transport, apiKey, userId });
    sessions.sse.set(sessionId, session);

    // Published before the stream opens: a client can post its first message to another
    // replica the instant it reads the endpoint event.
    try {
      await sessions.storeRecord({ transport: "sse", sessionId, apiKey });
    } catch (err) {
      logger.error({ error: err }, "Failed to record MCP SSE session in Redis");
    }

    await sessions.listenForRelayed({
      sessionId,
      onMessage: (rawMessage) => {
        void this.#deliverRelayed({ sessionId, session, rawMessage });
      },
    });

    res.on("close", () => {
      sessions.releaseSse(sessionId, apiKey).catch(() => undefined);
    });

    await sessions.connectServer({ transport, apiKey, userId });
  }

  /**
   * Authenticates before looking the session up, so a caller with no credentials is told it is
   * unauthorized rather than that its session is bad: the two need different fixes.
   */
  async handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http, auth, sessions } = this.#collaborators;
    const sessionId = new URL(req.url ?? "", "http://localhost").searchParams.get("sessionId");
    if (!sessionId) {
      http.sendJson(res, 400, { error: "Invalid or missing session ID" });
      return;
    }
    http.noteLogFields(res, { sessionId });

    const token = auth.extractBearer(req);
    if (!token) {
      http.send401(res, "Authorization header required");
      return;
    }
    const caller = await auth.resolveCaller(token);
    if (caller.kind === "refused") {
      auth.refuseBearer(req, res, token);
      return;
    }

    const local = sessions.sse.get(sessionId);
    if (local) {
      await this.#postLocally({ req, res, sessionId, apiKey: caller.apiKey, session: local });
      return;
    }
    await this.#relayToHolder({ req, res, sessionId, apiKey: caller.apiKey });
  }

  async #postLocally(input: {
    req: IncomingMessage;
    res: ServerResponse;
    sessionId: string;
    apiKey: string;
    session: McpSseSession;
  }): Promise<void> {
    const { http, sessions } = this.#collaborators;
    const { session } = input;
    if (input.apiKey !== session.apiKey) {
      http.send401(input.res, "Bearer token does not match session");
      return;
    }
    sessions.markActive(session);
    void sessions.touchRecord({
      transport: "sse",
      sessionId: input.sessionId,
      apiKey: session.apiKey,
    });

    const read = await http.readJsonBody(input.req, input.res);
    if (read.kind === "answered") return;

    await sessions.runAs(session.apiKey, () =>
      session.transport.handlePostMessage(input.req, input.res, read.body),
    );
  }

  /** Hands the message to the replica holding the stream; its reply travels down that stream. */
  async #relayToHolder(input: {
    req: IncomingMessage;
    res: ServerResponse;
    sessionId: string;
    apiKey: string;
  }): Promise<void> {
    const { http, sessions } = this.#collaborators;
    const { res, sessionId } = input;
    const record = await sessions.getRecordKey({ transport: "sse", sessionId });
    if (record.kind === "missing") {
      http.sendJson(res, 404, { error: "Session not found" });
      return;
    }
    if (input.apiKey !== record.apiKey) {
      http.send401(res, "Bearer token does not match session");
      return;
    }

    const read = await http.readJsonBody(input.req, res);
    if (read.kind === "answered") return;

    const receivers = await sessions.relay({ sessionId, message: JSON.stringify(read.body) });
    if (receivers === 0) {
      // The replica that held the stream is gone and the record outlived it: clear it so the
      // client reconnects instead of posting into a void.
      await sessions.removeRecord({ transport: "sse", sessionId, apiKey: record.apiKey });
      http.sendJson(res, 404, { error: "Session not found" });
      return;
    }

    await sessions.touchRecord({ transport: "sse", sessionId, apiKey: record.apiKey });
    // The same 202 the SDK's own transport answers a local post with.
    http.sendJson(res, 202, { status: "accepted" });
  }

  async #deliverRelayed(input: {
    sessionId: string;
    session: McpSseSession;
    rawMessage: string;
  }): Promise<void> {
    const { sessions } = this.#collaborators;
    const { session } = input;
    try {
      sessions.markActive(session);
      const message: JSONRPCMessage = JSON.parse(input.rawMessage);
      await sessions.runAs(session.apiKey, () => session.transport.handleMessage(message));
      await sessions.touchRecord({
        transport: "sse",
        sessionId: input.sessionId,
        apiKey: session.apiKey,
      });
    } catch (err) {
      logger.error(
        { error: err, sessionId: input.sessionId },
        "Failed to handle relayed MCP SSE message",
      );
    }
  }
}
