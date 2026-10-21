import { RateLimitedError } from "@langwatch/api";
import {
  McpAuthorizationRequiredError,
  type McpDoorAnswer,
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
import type { McpAnswerService, McpRequest } from "./mcp-answer.service.ts";
import type { McpCallerAuthService, McpCallerLookup } from "./mcp-caller-auth.service.ts";
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

/** A session request's caller and session, or the answer to give instead. */
type McpSessionResolution =
  | Readonly<{ kind: "found"; session: McpStreamableSession } & McpResolvedCaller>
  | Readonly<{ kind: "missing" } & McpResolvedCaller>
  | Readonly<{ kind: "answered"; answer: McpDoorAnswer }>;

type McpStreamableCollaborators = Readonly<{
  answers: McpAnswerService;
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

  async answerPost(request: McpRequest): Promise<McpDoorAnswer> {
    const { answers } = this.#collaborators;
    const read = await answers.readJsonBody(request);
    if (read.kind === "answered") return read.answer;

    const sessionId = extractSessionIdHeader(request.headers["mcp-session-id"]);
    if (!sessionId) {
      if (isInitializeRequest(read.body)) return this.#openSession({ request, body: read.body });
      return answers.refusal(new McpSessionIdRequiredError());
    }

    const resolution = await this.#resolveSession({ request, sessionId });
    if (resolution.kind === "answered") return resolution.answer;
    if (resolution.kind === "found") {
      return this.#drive({ request, sessionId, ...resolution, body: read.body });
    }
    // A client re-initializing under a lost session's id is served a new session.
    if (isInitializeRequest(read.body)) return this.#openSession({ request, body: read.body });
    return this.#answerMissing({ request, caller: resolution.caller });
  }

  async answerGet(request: McpRequest): Promise<McpDoorAnswer> {
    const sessionId = extractSessionIdHeader(request.headers["mcp-session-id"]);
    if (!sessionId) return this.#collaborators.answers.refusal(new McpSessionIdRequiredError());

    const resolution = await this.#resolveSession({ request, sessionId });
    if (resolution.kind === "answered") return resolution.answer;
    if (resolution.kind === "missing") {
      return this.#answerMissing({ request, caller: resolution.caller });
    }
    return this.#drive({ request, sessionId, ...resolution });
  }

  /** The client ending its session: the one place a session record is removed. */
  async answerDelete(request: McpRequest): Promise<McpDoorAnswer> {
    const { answers, sessions } = this.#collaborators;
    const sessionId = extractSessionIdHeader(request.headers["mcp-session-id"]);
    if (!sessionId) return this.#sessionNotFound(request);

    const resolution = await this.#resolveSession({ request, sessionId });
    if (resolution.kind === "answered") return resolution.answer;
    const { session } = resolution.kind === "found" ? resolution : { session: undefined };
    if (!session || !sessions.adoptsCaller({ sessionId, session, caller: resolution.caller })) {
      return this.#answerMissing({ request, caller: resolution.caller });
    }

    request.noteLogFields({ projectId: session.projectId });
    sessions.streamable.delete(sessionId);
    await session.transport.close();
    await sessions.removeRecord({ sessionId, apiKey: session.apiKey });
    return answers.json(200, { status: "session closed" });
  }

  /**
   * The bearer first, then the session: held here, or rebuilt from its record for a caller that
   * owns it. Naming someone else's session id rebuilds nothing and reads as missing.
   */
  async #resolveSession(input: {
    request: McpRequest;
    sessionId: string;
  }): Promise<McpSessionResolution> {
    const { answers, auth, sessions } = this.#collaborators;
    const { request } = input;
    const token = auth.extractBearer(request);
    if (!token) {
      return { kind: "answered", answer: answers.refusal(new McpAuthorizationRequiredError()) };
    }
    const caller = await auth.resolveCaller(token);
    if (caller.kind !== "resolved") {
      return { kind: "answered", answer: auth.answerUnresolved({ request, token, caller }) };
    }

    const held = sessions.streamable.get(input.sessionId);
    if (held) return { kind: "found", session: held, token, caller };
    try {
      const rebuilt = await this.#rebuildOnce({ sessionId: input.sessionId, caller });
      request.noteLogFields({ sessionOutcome: rebuilt.kind === "found" ? "rebuilt" : "missing" });
      return { ...rebuilt, token, caller };
    } catch (err) {
      logger.error({ error: err }, "MCP session recovery failed");
      return { kind: "answered", answer: answers.refusal(new McpStoreUnavailableError()) };
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
    request: McpRequest;
    sessionId: string;
    caller: McpResolvedCaller["caller"];
    session: McpStreamableSession;
    body?: unknown;
  }): Promise<McpDoorAnswer> {
    const { answers, sessions } = this.#collaborators;
    const { request, session, sessionId, caller } = input;
    if (!sessions.adoptsCaller({ sessionId, session, caller })) {
      return this.#answerMissing({ request, caller });
    }

    request.noteLogFields({ projectId: session.projectId });
    sessions.markActive(session);
    void sessions.touchRecord({ sessionId, apiKey: session.apiKey });
    return answers.stream({
      transport: session.transport,
      apiKey: session.apiKey,
      body: input.body,
    });
  }

  /** A new session: an initialize request, from an authenticated caller under the session limit. */
  async #openSession(input: { request: McpRequest; body: unknown }): Promise<McpDoorAnswer> {
    const { answers, auth, sessions } = this.#collaborators;
    const { request } = input;
    // Failed auth is counted inside authenticate; here it is only checked.
    if (auth.isAuthFailureBlocked(request)) return answers.refusal(new RateLimitedError());

    const authentication = await auth.authenticate(request);
    if (authentication.kind === "answered") return authentication.answer;
    const { apiKey, projectId } = authentication;

    const caller = await auth.resolveOptionalCaller(auth.extractBearer(request));
    const userId = caller.kind === "resolved" ? caller.userId : undefined;

    if (await sessions.isAtSessionLimit(apiKey)) {
      return answers.refusal(
        new McpSessionLimitReachedError({ maxSessions: MAX_SESSIONS_PER_KEY }),
      );
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

    request.noteLogFields({ sessionOutcome: "opened" });
    try {
      await sessions.connectServer({ transport, apiKey, projectId, userId });
    } catch (error) {
      // The stream was about to start, so the refusal keeps the stream's unbuffered header.
      return answers.unbuffered(answers.failure({ error, url: request.url }));
    }
    return answers.stream({ transport, apiKey, body: input.body });
  }

  /**
   * Rebuilds a session from its record, for its own key or a refreshed token of the same person
   * and project. WORKAROUND: the SDK transport starts uninitialized, so its inner state is patched
   * to accept the existing session id; checked against @modelcontextprotocol/sdk@1.29.0.
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
    request: McpRequest;
    caller: McpResolvedCaller["caller"];
  }): Promise<McpDoorAnswer> {
    const { auth, answers } = this.#collaborators;
    const live = await auth.credentialIsLive(input.caller);
    if (live === "unavailable") return answers.refusal(new McpStoreUnavailableError());
    if (!live) return auth.refuseBearer({ request: input.request, token: input.caller.apiKey });
    return this.#sessionNotFound(input.request);
  }

  #sessionNotFound(request: McpRequest): McpDoorAnswer {
    request.noteLogFields({ sessionOutcome: "missing" });
    return this.#collaborators.answers.refusal(new McpSessionNotFoundError());
  }
}
