import type { IncomingMessage, ServerResponse } from "node:http";

import { HandledError } from "@langwatch/handled-error";
import {
  McpAuthorizationRequiredError,
  McpGrantRevokedError,
  McpInvalidApiKeyError,
  McpInvalidTokenError,
  McpStoreUnavailableError,
} from "@langwatch/hosted-mcp-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { extractBearerToken } from "../rules/mcp-routes.rules.ts";
import type { AuthzMcpSessionGrantService } from "./authz-mcp-session-grant.service.ts";
import type { McpHttpService } from "./mcp-http.service.ts";
import type { McpCliSessions } from "./mcp-oauth-token.service.ts";
import { McpRateLimitService } from "./mcp-rate-limit.service.ts";
import type {
  McpLiveProjectLookup,
  ProjectMcpProjectLookupService,
} from "./project-mcp-project-lookup.service.ts";
import type { ResolvedMcpClientAddressService } from "./resolved-mcp-client-address.service.ts";

const logger = createLogger("langwatch:mcp");

/**
 * How long a re-checked grant is trusted. A refresh token outlives the access token it rotates,
 * so the membership behind it is re-proved on this cadence: an offboarded person loses the
 * session in minutes.
 */
const GRANT_RECHECK_INTERVAL_MS = 5 * 60 * 1000;

/** The access tokens auth mints for a person; anything else is read as a project key. */
const ACCESS_TOKEN_PREFIX = "lw_at_";

/**
 * A bearer read: the credential tool calls run on, and the person and project an access token is
 * bound to (absent for a project key passed as the bearer), a refusal, or no answer because a
 * store the check needs is down (never read as a bad token: a 401 sends the client to sign in).
 */
export type McpCallerLookup =
  | Readonly<{
      kind: "resolved";
      apiKey: string;
      userId: string | undefined;
      projectId: string | undefined;
    }>
  | Readonly<{ kind: "refused" }>
  | Readonly<{ kind: "unavailable" }>;

/** An access token read, or why there is none. */
type McpAccessTokenRead =
  | Readonly<{ kind: "session"; userId: string; projectId: string }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "unavailable" }>;

/** An authenticated request's key and the project it belongs to, or a 401 already sent. */
type McpAuthentication =
  | Readonly<{ kind: "authenticated"; apiKey: string; projectId: string }>
  | Readonly<{ kind: "answered" }>;

type McpCallerAuthCollaborators = Readonly<{
  cliSessions: Pick<McpCliSessions, "getCliAccessSession">;
  projects: Pick<ProjectMcpProjectLookupService, "resolveLiveProjectByApiKey">;
  grants: Pick<AuthzMcpSessionGrantService, "stillGranted">;
  address: Pick<ResolvedMcpClientAddressService, "clientIp">;
  http: McpHttpService;
}>;

/** Who a bearer speaks for, whether its grant still holds, and each caller's failed-auth budget. */
export class McpCallerAuthService {
  readonly #collaborators: McpCallerAuthCollaborators;
  /** The last grant probe per bearer, so a refused caller learns the grant is gone. */
  readonly #grantChecks = new Map<string, { checkedAt: number; granted: boolean }>();
  readonly #authFailures = McpRateLimitService.create({ windowMs: 60_000, maxRequests: 20 });

  private constructor(collaborators: McpCallerAuthCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(collaborators: McpCallerAuthCollaborators): McpCallerAuthService {
    return new McpCallerAuthService(collaborators);
  }

  extractBearer(req: IncomingMessage): string | undefined {
    return extractBearerToken(req.headers.authorization);
  }

  /** The rate-limit bucket: the address the rest of the deployment limits on. */
  clientIpOf(req: IncomingMessage): string {
    return this.#collaborators.address.clientIp(req);
  }

  isAuthFailureBlocked(req: IncomingMessage): boolean {
    return this.#authFailures.isBlocked(this.clientIpOf(req));
  }

  /**
   * An access token is the person capped at a project, re-proved; a project key is its own
   * check.
   */
  async resolveCaller(token: string): Promise<McpCallerLookup> {
    if (!token.startsWith(ACCESS_TOKEN_PREFIX)) {
      return { kind: "resolved", apiKey: token, userId: undefined, projectId: undefined };
    }
    const session = await this.#readAccessToken(token);
    if (session.kind !== "session")
      return { kind: session.kind === "invalid" ? "refused" : "unavailable" };
    const { userId, projectId } = session;
    const granted = await this.#grantStillHolds({ token, userId, projectId });
    if (granted === "unavailable") return { kind: "unavailable" };
    return granted ? { kind: "resolved", apiKey: token, userId, projectId } : { kind: "refused" };
  }

  /** A request that presented no bearer reads as refused. */
  async resolveOptionalCaller(token: string | undefined): Promise<McpCallerLookup> {
    return token ? this.resolveCaller(token) : { kind: "refused" };
  }

  /** Answers a bearer that did not resolve: 503 while a store is down, else a counted 401. */
  async answerUnresolved(
    req: IncomingMessage,
    res: ServerResponse,
    input: { token: string; caller: Exclude<McpCallerLookup, { kind: "resolved" }> },
  ): Promise<void> {
    if (input.caller.kind === "unavailable") {
      await this.#collaborators.http.sendHandled(res, new McpStoreUnavailableError());
      return;
    }
    await this.refuseBearer(req, res, input.token);
  }

  /**
   * Whether a resolved caller's credential is live. An access token was proved when it resolved; a
   * project key is only compared to the session's until here, so it is looked up now.
   */
  async credentialIsLive(
    caller: Extract<McpCallerLookup, { kind: "resolved" }>,
  ): Promise<boolean | "unavailable"> {
    if (caller.projectId !== undefined) return true;
    const lookup = await this.#validateApiKey(caller.apiKey);
    return lookup.kind === "unavailable" ? "unavailable" : lookup.kind === "live";
  }

  /** Tracks the failure and refuses with the reason the client can act on. */
  async refuseBearer(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
    this.#authFailures.track(this.clientIpOf(req));
    await this.#collaborators.http.sendHandled(
      res,
      this.isGrantRevoked(token) ? new McpGrantRevokedError() : new McpInvalidTokenError(),
    );
  }

  /** Whether this bearer was refused because its minting grant is gone. */
  isGrantRevoked(token: string): boolean {
    return this.#grantChecks.get(token)?.granted === false;
  }

  /** Bearer, then the key it resolves to, then the key's project: any miss answers 401. */
  async authenticate(req: IncomingMessage, res: ServerResponse): Promise<McpAuthentication> {
    const { http } = this.#collaborators;
    const token = this.extractBearer(req);
    if (!token) {
      await http.sendHandled(res, new McpAuthorizationRequiredError());
      return { kind: "answered" };
    }

    const caller = await this.resolveCaller(token);
    if (caller.kind !== "resolved") {
      await this.answerUnresolved(req, res, { token, caller });
      return { kind: "answered" };
    }

    const lookup = caller.projectId
      ? ({ kind: "live", project: { id: caller.projectId } } as const)
      : await this.#validateApiKey(caller.apiKey);
    if (lookup.kind === "unavailable") {
      await http.sendHandled(res, new McpStoreUnavailableError());
      return { kind: "answered" };
    }
    if (lookup.kind === "unknown") {
      this.#authFailures.track(this.clientIpOf(req));
      await http.sendHandled(res, new McpInvalidApiKeyError());
      return { kind: "answered" };
    }
    const projectId = lookup.project.id;

    // MCP runs outside the app's request context, so the access log carries the tenant instead.
    http.noteLogFields(res, { projectId });
    return { kind: "authenticated", apiKey: caller.apiKey, projectId };
  }

  /**
   * The project a key belongs to, for a session record written before records carried one.
   * Throws while the store is down, so the caller answers 503 rather than "no such session".
   */
  async projectIdOf(apiKey: string): Promise<string | undefined> {
    const lookup = await this.#validateApiKey(apiKey);
    if (lookup.kind === "unavailable") throw new McpStoreUnavailableError();
    return lookup.kind === "live" ? lookup.project.id : undefined;
  }

  sweep(now: number): void {
    for (const [token, check] of this.#grantChecks) {
      if (now - check.checkedAt > GRANT_RECHECK_INTERVAL_MS) this.#grantChecks.delete(token);
    }
    this.#authFailures.sweep();
  }

  clearGrantChecks(): void {
    this.#grantChecks.clear();
  }

  clearRateLimiter(): void {
    this.#authFailures.clear();
  }

  /** The person and project an access token is bound to, or why it is not usable here. */
  async #readAccessToken(token: string): Promise<McpAccessTokenRead> {
    try {
      const session = await this.#collaborators.cliSessions.getCliAccessSession({
        authorization: `Bearer ${token}`,
      });
      return session.projectId === undefined
        ? { kind: "invalid" }
        : { kind: "session", userId: session.userId, projectId: session.projectId };
    } catch (err) {
      // Auth refuses a bad token with a handled error; anything else is the store failing.
      if (HandledError.isHandled(err)) return { kind: "invalid" };
      logger.error({ error: err }, "MCP access token read failed");
      return { kind: "unavailable" };
    }
  }

  /** Probed on first use and every {@link GRANT_RECHECK_INTERVAL_MS} after. */
  async #grantStillHolds(input: {
    token: string;
    userId: string;
    projectId: string;
  }): Promise<boolean | "unavailable"> {
    const cached = this.#grantChecks.get(input.token);
    if (cached && nowInstant().epochMilliseconds - cached.checkedAt < GRANT_RECHECK_INTERVAL_MS) {
      return cached.granted;
    }
    let granted: boolean;
    try {
      granted = await this.#collaborators.grants.stillGranted({
        userId: input.userId,
        projectId: input.projectId,
      });
    } catch (err) {
      logger.error({ error: err }, "MCP grant re-check failed");
      this.#grantChecks.delete(input.token);
      return "unavailable";
    }
    this.#grantChecks.set(input.token, { checkedAt: nowInstant().epochMilliseconds, granted });
    return granted;
  }

  async #validateApiKey(
    apiKey: string,
  ): Promise<McpLiveProjectLookup | Readonly<{ kind: "unavailable" }>> {
    try {
      return await this.#collaborators.projects.resolveLiveProjectByApiKey({ apiKey });
    } catch (err) {
      logger.error({ error: err }, "Database API key validation failed");
      return { kind: "unavailable" };
    }
  }
}
