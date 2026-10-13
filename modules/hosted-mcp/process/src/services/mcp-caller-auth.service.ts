import type { IncomingMessage, ServerResponse } from "node:http";

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { extractBearerToken } from "../rules/mcp-routes.rules.ts";
import type { AuthzMcpSessionGrantService } from "./authz-mcp-session-grant.service.ts";
import type { HeaderMcpClientAddressService } from "./header-mcp-client-address.service.ts";
import type { McpHttpService } from "./mcp-http.service.ts";
import type { McpCliSessions } from "./mcp-oauth-token.service.ts";
import { McpRateLimitService } from "./mcp-rate-limit.service.ts";
import type {
  McpLiveProjectLookup,
  ProjectMcpProjectLookupService,
} from "./project-mcp-project-lookup.service.ts";

const logger = createLogger("langwatch:mcp");

/**
 * How long a re-checked grant is trusted. A refresh token outlives the access token it rotates,
 * so the membership behind it is re-proved on this cadence: an offboarded person loses the
 * session in minutes.
 */
const GRANT_RECHECK_INTERVAL_MS = 5 * 60 * 1000;

/** The refusal a caller whose minting grant is gone reads on the wire. */
const GRANT_REVOKED_CODE = "mcp_grant_revoked";

/** The access tokens auth mints for a person; anything else is read as a project key. */
const ACCESS_TOKEN_PREFIX = "lw_at_";

/**
 * A bearer read: the credential tool calls run on, and the person and project an access token is
 * bound to (absent for a project key passed as the bearer), or a refusal.
 */
export type McpCallerLookup =
  | Readonly<{
      kind: "resolved";
      apiKey: string;
      userId: string | undefined;
      projectId: string | undefined;
    }>
  | Readonly<{ kind: "refused" }>;

/** An authenticated request's key and the project it belongs to, or a 401 already sent. */
type McpAuthentication =
  | Readonly<{ kind: "authenticated"; apiKey: string; projectId: string }>
  | Readonly<{ kind: "answered" }>;

type McpCallerAuthCollaborators = Readonly<{
  cliSessions: Pick<McpCliSessions, "getCliAccessSession">;
  projects: Pick<ProjectMcpProjectLookupService, "resolveLiveProjectByApiKey">;
  grants: Pick<AuthzMcpSessionGrantService, "stillGranted">;
  address: Pick<HeaderMcpClientAddressService, "clientIp">;
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
    if (session === null) return { kind: "refused" };
    const { userId, projectId } = session;
    const granted = await this.#grantStillHolds({ token, userId, projectId });
    return granted ? { kind: "resolved", apiKey: token, userId, projectId } : { kind: "refused" };
  }

  /** A request that presented no bearer reads as refused. */
  async resolveOptionalCaller(token: string | undefined): Promise<McpCallerLookup> {
    return token ? this.resolveCaller(token) : { kind: "refused" };
  }

  /** Tracks the failure and refuses with the reason the client can act on. */
  refuseBearer(req: IncomingMessage, res: ServerResponse, token: string): void {
    this.#authFailures.track(this.clientIpOf(req));
    this.#collaborators.http.send401(
      res,
      this.isGrantRevoked(token) ? GRANT_REVOKED_CODE : "Invalid or expired token",
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
      http.send401(res, "Authorization required");
      return { kind: "answered" };
    }

    const caller = await this.resolveCaller(token);
    if (caller.kind === "refused") {
      this.refuseBearer(req, res, token);
      return { kind: "answered" };
    }

    const projectId = caller.projectId ?? (await this.projectIdOf(caller.apiKey));
    if (projectId === undefined) {
      this.#authFailures.track(this.clientIpOf(req));
      http.send401(res, "Invalid API key");
      return { kind: "answered" };
    }

    // MCP runs outside the app's request context, so the access log carries the tenant instead.
    http.noteLogFields(res, { projectId });
    return { kind: "authenticated", apiKey: caller.apiKey, projectId };
  }

  /** The project a key belongs to, for a session record written before records carried one. */
  async projectIdOf(apiKey: string): Promise<string | undefined> {
    const lookup = await this.#validateApiKey(apiKey);
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

  /** The person and project an access token is bound to, or nothing when it is not usable here. */
  async #readAccessToken(
    token: string,
  ): Promise<Readonly<{ userId: string; projectId: string }> | null> {
    try {
      const session = await this.#collaborators.cliSessions.getCliAccessSession({
        authorization: `Bearer ${token}`,
      });
      return session.projectId === undefined
        ? null
        : { userId: session.userId, projectId: session.projectId };
    } catch (err) {
      if (!HandledError.isHandled(err))
        logger.error({ error: err }, "MCP access token read failed");
      return null;
    }
  }

  /** Probed on first use and every {@link GRANT_RECHECK_INTERVAL_MS} after. */
  async #grantStillHolds(input: {
    token: string;
    userId: string;
    projectId: string;
  }): Promise<boolean> {
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
      return false;
    }
    this.#grantChecks.set(input.token, { checkedAt: nowInstant().epochMilliseconds, granted });
    return granted;
  }

  async #validateApiKey(apiKey: string): Promise<McpLiveProjectLookup> {
    try {
      return await this.#collaborators.projects.resolveLiveProjectByApiKey({ apiKey });
    } catch (err) {
      logger.error({ error: err }, "Database API key validation failed");
      return { kind: "unknown" };
    }
  }
}
