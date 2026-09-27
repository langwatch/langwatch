import type { IncomingMessage, ServerResponse } from "node:http";

import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type {
  McpClientAddress,
  McpLiveProjectLookup,
  McpProjectLookup,
  McpSessionGrant,
} from "../app/hosted-mcp.members.ts";
import { extractBearerToken } from "../rules/mcp-routes.rules.ts";
import type { McpHttpService } from "./mcp-http.service.ts";
import type { McpOAuthTokenService } from "./mcp-oauth-token.service.ts";
import { McpRateLimitService } from "./mcp-rate-limit.service.ts";

const logger = createLogger("langwatch:mcp");

/**
 * How long a re-checked grant is trusted. The bearer lives thirty days; the membership behind it
 * is re-proved on this cadence, so an offboarded person loses the session in minutes.
 */
const GRANT_RECHECK_INTERVAL_MS = 5 * 60 * 1000;

/** The refusal a caller whose minting grant is gone reads on the wire. */
const GRANT_REVOKED_CODE = "mcp_grant_revoked";

/**
 * A bearer read: the key it stands for, and the person who approved it when it was minted by the
 * OAuth flow (absent for a project key passed as the bearer), or a refusal.
 */
export type McpCallerLookup =
  | Readonly<{ kind: "resolved"; apiKey: string; userId: string | undefined }>
  | Readonly<{ kind: "refused" }>;

/** An authenticated request's key, or a 401 already sent to the caller. */
export type McpAuthentication =
  | Readonly<{ kind: "authenticated"; apiKey: string }>
  | Readonly<{ kind: "answered" }>;

type McpCallerAuthCollaborators = Readonly<{
  oauthTokens: McpOAuthTokenService;
  projects: McpProjectLookup;
  grants: McpSessionGrant;
  address: McpClientAddress;
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

  /** An OAuth-minted token runs on its approval, re-proved; a project key is its own check. */
  async resolveCaller(token: string): Promise<McpCallerLookup> {
    const lookup = await this.#collaborators.oauthTokens.resolve(token);
    if (lookup.kind === "refused") return { kind: "refused" };
    const { apiKey, userId } = lookup.context;
    if (userId === undefined) return { kind: "resolved", apiKey, userId };
    const granted = await this.#grantStillHolds({ token, apiKey, userId });
    return granted ? { kind: "resolved", apiKey, userId } : { kind: "refused" };
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

    const lookup = await this.#validateApiKey(caller.apiKey);
    if (lookup.kind === "unknown") {
      this.#authFailures.track(this.clientIpOf(req));
      http.send401(res, "Invalid API key");
      return { kind: "answered" };
    }

    return { kind: "authenticated", apiKey: caller.apiKey };
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

  /** Probed on first use and every {@link GRANT_RECHECK_INTERVAL_MS} after. */
  async #grantStillHolds(input: {
    token: string;
    apiKey: string;
    userId: string;
  }): Promise<boolean> {
    const cached = this.#grantChecks.get(input.token);
    if (cached && nowInstant().epochMilliseconds - cached.checkedAt < GRANT_RECHECK_INTERVAL_MS) {
      return cached.granted;
    }
    const lookup = await this.#validateApiKey(input.apiKey);
    if (lookup.kind === "unknown") {
      this.#grantChecks.delete(input.token);
      return false;
    }
    let granted: boolean;
    try {
      granted = await this.#collaborators.grants.stillGranted({
        userId: input.userId,
        projectId: lookup.project.id,
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
