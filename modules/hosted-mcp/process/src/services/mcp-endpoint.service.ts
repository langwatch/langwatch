import type { IncomingMessage, ServerResponse } from "node:http";

import { registerRoutePolicy } from "@langwatch/api";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { initConfig, tryGetConfig } from "@langwatch/mcp-server/config";
import { classifyClient, createLogger, endpointClassOf } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { McpSessionRelayChannel } from "../channels/mcp-session-relay.channel.ts";
import type { McpOAuthClientRepository } from "../repositories/mcp-oauth-client.repository.ts";
import type { McpOAuthTokenRepository } from "../repositories/mcp-oauth-token.repository.ts";
import type { McpSessionRepository } from "../repositories/mcp-session.repository.ts";
import {
  AUTHORIZATION_SERVER_METADATA_PATH,
  classifyMetadataSubtreePath,
  hostedMcpRoutePolicies,
  isMcpRoute,
  PROTECTED_RESOURCE_METADATA_PATH,
} from "../rules/mcp-routes.rules.ts";
import type { AuthzMcpSessionGrantService } from "./authz-mcp-session-grant.service.ts";
import type { HeaderMcpClientAddressService } from "./header-mcp-client-address.service.ts";
import { McpCallerAuthService } from "./mcp-caller-auth.service.ts";
import { McpHttpService } from "./mcp-http.service.ts";
import { McpOAuthEndpointService } from "./mcp-oauth-endpoint.service.ts";
import {
  type McpApiKeyCipher,
  type McpCliSessions,
  McpOAuthTokenService,
} from "./mcp-oauth-token.service.ts";
import { McpSessionService } from "./mcp-session.service.ts";
import { McpSseTransportService } from "./mcp-sse-transport.service.ts";
import { McpStreamableTransportService } from "./mcp-streamable-transport.service.ts";
import type { ProjectMcpProjectLookupService } from "./project-mcp-project-lookup.service.ts";

const logger = createLogger("langwatch:mcp");

const REAPER_INTERVAL_MS = 60 * 1000;

/** The long-lived MCP HTTP surface one process mounts on its raw Node listener. */
export interface McpHandler {
  handleRequest: (req: IncomingMessage, res: ServerResponse) => void;
  isMcpRoute: (pathname: string) => boolean;
  /** Clear the in-memory OAuth token cache (for testing). */
  clearTokenCache: () => void;
  /** Clear the in-memory OAuth/auth-failure rate limiter state (for testing). */
  clearRateLimiters: () => void;
  /** Close all active sessions and release their records (graceful shutdown). */
  closeAllSessions: () => Promise<void>;
}

export type McpEndpointCollaborators = Readonly<{
  sessionRecords: McpSessionRepository;
  relay: McpSessionRelayChannel;
  oauthTokenRecords: McpOAuthTokenRepository;
  oauthClients: McpOAuthClientRepository;
  projects: Pick<ProjectMcpProjectLookupService, "resolveLiveProjectByApiKey">;
  grants: Pick<AuthzMcpSessionGrantService, "stillGranted">;
  cliSessions: McpCliSessions;
  cipher: McpApiKeyCipher;
  address: Pick<HeaderMcpClientAddressService, "clientIp">;
  sessionTools?: Pick<GovernanceRestApi, "registerMcpTools"> | undefined;
  /** The public origin the MCP client is told to come back to. */
  baseHost: string;
}>;

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/** A path answers per method, or the same whatever the method (health, the 404 documents). */
type RouteVerbs =
  | Readonly<{ anyMethod: RouteHandler }>
  | Readonly<{ byMethod: ReadonlyMap<string, RouteHandler> }>;

/**
 * The hosted MCP endpoint: the Streamable HTTP and SSE transports, OAuth discovery, registration
 * and token exchange, CORS, the access log, and the reaper that bounds abandoned state.
 */
export class McpEndpointService implements McpHandler {
  readonly #http: McpHttpService;
  readonly #auth: McpCallerAuthService;
  readonly #oauthTokens: McpOAuthTokenService;
  readonly #sessions: McpSessionService;
  readonly #oauth: McpOAuthEndpointService;
  readonly #routes: ReadonlyMap<string, RouteVerbs>;
  readonly #reaper: ReturnType<typeof setInterval>;

  private constructor(collaborators: McpEndpointCollaborators) {
    const http = McpHttpService.create({ baseHost: collaborators.baseHost });
    this.#http = http;
    this.#oauthTokens = McpOAuthTokenService.create({
      repository: collaborators.oauthTokenRecords,
      issuer: collaborators.cliSessions,
    });
    const auth = McpCallerAuthService.create({
      ...collaborators,
      http,
    });
    this.#auth = auth;
    this.#sessions = McpSessionService.create({
      records: collaborators.sessionRecords,
      relay: collaborators.relay,
      cipher: collaborators.cipher,
      sessionTools: collaborators.sessionTools,
    });
    this.#oauth = McpOAuthEndpointService.create({
      http,
      auth,
      oauthTokens: this.#oauthTokens,
      clients: collaborators.oauthClients,
    });
    this.#routes = this.#routeTable({
      streamable: McpStreamableTransportService.create({ http, auth, sessions: this.#sessions }),
      sse: McpSseTransportService.create({ http, auth, sessions: this.#sessions }),
    });
    this.#reaper = setInterval(() => this.#reap(), REAPER_INTERVAL_MS);
    // The process may exit while the reaper is still scheduled.
    this.#reaper.unref();
  }

  /** Composed means mounted, and mounted means the route-policy audit should see it. */
  static create(collaborators: McpEndpointCollaborators): McpEndpointService {
    // Asked rather than demanded: a cold process never has a config yet, and the demanding call
    // answers that normal case with a stack trace before it throws.
    if (tryGetConfig() === undefined) initConfig({ endpoint: collaborators.baseHost });
    McpEndpointService.registerRoutePolicies();
    return new McpEndpointService(collaborators);
  }

  /** Puts this family in the process-wide route-policy registry. Idempotent. */
  static registerRoutePolicies(): void {
    for (const route of hostedMcpRoutePolicies()) {
      registerRoutePolicy(route);
    }
  }

  isMcpRoute = (pathname: string): boolean => isMcpRoute(pathname);

  handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    const method = req.method ?? "GET";

    this.#logOnCompletion({ req, res, pathname, method });
    // CORS on every MCP route, error responses included.
    this.#http.setCorsHeaders(res);

    if (method === "OPTIONS" && isMcpRoute(pathname)) {
      res.writeHead(200);
      res.end();
      return;
    }

    this.#dispatch({ req, res, pathname, method }).catch((err: unknown) => {
      logger.error({ error: err, url: req.url }, "MCP handler error");
      if (!res.headersSent) this.#http.sendJson(res, 500, { error: "Internal server error" });
    });
  };

  clearTokenCache = (): void => {
    this.#auth.clearGrantChecks();
  };

  clearRateLimiters = (): void => {
    this.#oauth.clearRateLimiters();
    this.#auth.clearRateLimiter();
  };

  closeAllSessions = async (): Promise<void> => {
    clearInterval(this.#reaper);
    await this.#sessions.closeAll();
  };

  async #dispatch(input: {
    req: IncomingMessage;
    res: ServerResponse;
    pathname: string;
    method: string;
  }): Promise<void> {
    const { req, res, pathname, method } = input;
    // RFC 9728 path-suffixed discovery, tried before the bare form by every current MCP client.
    if (this.#serveMetadataSubtree({ res, pathname, method })) return;

    const verbs = this.#routes.get(pathname);
    if (!verbs) {
      this.#http.sendJson(res, 404, { error: "Not found" });
      return;
    }
    const handle = "anyMethod" in verbs ? verbs.anyMethod : verbs.byMethod.get(method);
    if (!handle) {
      this.#http.sendMethodNotAllowed(res);
      return;
    }
    await handle(req, res);
  }

  #routeTable(transports: {
    streamable: McpStreamableTransportService;
    sse: McpSseTransportService;
  }): ReadonlyMap<string, RouteVerbs> {
    const oauth = this.#oauth;
    const { streamable, sse } = transports;
    const only = (method: string, handler: RouteHandler): RouteVerbs => ({
      byMethod: new Map([[method, handler]]),
    });
    const sseMessage = only("POST", (req, res) => sse.handleMessage(req, res));
    return new Map<string, RouteVerbs>([
      [
        "/mcp/health",
        { anyMethod: (_req, res) => this.#http.sendJson(res, 200, { status: "ok" }) },
      ],
      [
        PROTECTED_RESOURCE_METADATA_PATH,
        only("GET", (_req, res) => oauth.handleProtectedResourceMetadata(res)),
      ],
      [
        AUTHORIZATION_SERVER_METADATA_PATH,
        only("GET", (_req, res) => oauth.handleAuthorizationServerMetadata(res)),
      ],
      // Not an OpenID provider: claimed so the probe gets a JSON 404 rather than the app.
      [
        "/.well-known/openid-configuration",
        { anyMethod: (_req, res) => oauth.handleUnpublishedMetadata(res) },
      ],
      ["/oauth/register", only("POST", (req, res) => oauth.handleRegister(req, res))],
      ["/oauth/token", only("POST", (req, res) => oauth.handleToken(req, res))],
      [
        "/mcp",
        {
          byMethod: new Map<string, RouteHandler>([
            ["POST", (req, res) => streamable.handlePost(req, res)],
            ["GET", (req, res) => streamable.handleGet(req, res)],
            ["DELETE", (req, res) => streamable.handleDelete(req, res)],
          ]),
        },
      ],
      ["/sse", only("GET", (req, res) => sse.handleConnect(req, res))],
      ["/messages", sseMessage],
      ["/sse/messages", sseMessage],
    ]);
  }

  /** Whether the request belonged to a path-suffixed discovery subtree and has been answered. */
  #serveMetadataSubtree(input: { res: ServerResponse; pathname: string; method: string }): boolean {
    const path = classifyMetadataSubtreePath(input.pathname);
    if (path.kind === "outside") return false;
    if (input.method !== "GET") {
      this.#http.sendMethodNotAllowed(input.res);
    } else if (path.kind === "unpublished") {
      this.#oauth.handleUnpublishedMetadata(input.res);
    } else if (path.kind === "protected-resource") {
      this.#oauth.handleProtectedResourceMetadata(input.res, path.resourceSuffix);
    } else {
      this.#oauth.handleAuthorizationServerMetadata(input.res);
    }
    return true;
  }

  /** One access log line per request once the response is done; logging never breaks a request. */
  #logOnCompletion(input: {
    req: IncomingMessage;
    res: ServerResponse;
    pathname: string;
    method: string;
  }): void {
    const { req, res } = input;
    try {
      const startedAt = nowInstant().epochMilliseconds;
      const userAgent = req.headers["user-agent"] ?? null;
      const attribution = {
        endpointClass: endpointClassOf(input.pathname),
        ...classifyClient((name) => {
          const value = req.headers[name];
          return Array.isArray(value) ? value[0] : value;
        }),
      };
      res.once("close", () => {
        try {
          logger.info(
            {
              method: input.method,
              path: input.pathname,
              status: res.statusCode,
              durationMs: nowInstant().epochMilliseconds - startedAt,
              userAgent,
              ...attribution,
              ...this.#http.logFieldsOf(res),
            },
            "MCP request",
          );
        } catch {
          // Logging must not break request handling.
        }
      });
      const headerSessionId = req.headers["mcp-session-id"];
      if (typeof headerSessionId === "string") {
        this.#http.noteLogFields(res, { sessionId: headerSessionId });
      }
    } catch {
      // Logging must not break request handling.
    }
  }

  /** Bounds the memory of abandoned sessions and stale probes. */
  #reap(): void {
    const now = nowInstant().epochMilliseconds;
    this.#sessions.reapIdle(now);
    this.#auth.sweep(now);
    this.#oauth.sweep();
  }
}
