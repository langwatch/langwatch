import { registerRoutePolicy } from "@langwatch/api";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import {
  type HostedMcpHandler,
  type McpDoorAccessLog,
  type McpDoorAnswer,
  type McpDoorReply,
  type McpDoorRequest,
  type McpSessionRunner,
  McpMethodNotAllowedError,
  McpRouteNotFoundError,
} from "@langwatch/hosted-mcp-contract";
import { initConfig, tryGetConfig } from "@langwatch/mcp-server/config";
import { classifyClient, endpointClassOf } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

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
import { McpAnswerService, type McpRequest } from "./mcp-answer.service.ts";
import { McpCallerAuthService } from "./mcp-caller-auth.service.ts";
import { McpOAuthEndpointService } from "./mcp-oauth-endpoint.service.ts";
import { type McpCliSessions, McpOAuthTokenService } from "./mcp-oauth-token.service.ts";
import { McpSessionService } from "./mcp-session.service.ts";
import { McpStreamableTransportService } from "./mcp-streamable-transport.service.ts";
import type { ProjectMcpProjectLookupService } from "./project-mcp-project-lookup.service.ts";

const REAPER_INTERVAL_MS = 60 * 1000;

/** Under the shortest idle timeout a proxy in front of us is likely to use (ALB and nginx: 60s). */
const KEEPALIVE_INTERVAL_MS = 20 * 1000;

/**
 * The long-lived MCP surface one process mounts: it decides each request's answer, and the raw
 * HTTP door writes it.
 */
export interface McpHandler extends HostedMcpHandler {
  /** Whether this replica holds a live copy of the session (for testing). */
  holdsSession: (sessionId: string) => boolean;
}

type McpEndpointCollaborators = Readonly<{
  sessionRecords: McpSessionRepository;
  oauthTokenRecords: McpOAuthTokenRepository;
  oauthClients: McpOAuthClientRepository;
  projects: Pick<ProjectMcpProjectLookupService, "resolveLiveProjectByApiKey">;
  grants: Pick<AuthzMcpSessionGrantService, "stillGranted">;
  cliSessions: McpCliSessions;
  address: Pick<HeaderMcpClientAddressService, "clientIp">;
  sessionTools?: Pick<GovernanceRestApi, "registerMcpTools"> | undefined;
  /** The public origin the MCP client is told to come back to. */
  baseHost: string;
}>;

type RouteHandler = (request: McpRequest) => McpDoorAnswer | Promise<McpDoorAnswer>;

/** A path answers per method, or the same whatever the method (health, the 404 documents). */
type RouteVerbs =
  | Readonly<{ anyMethod: RouteHandler }>
  | Readonly<{ byMethod: ReadonlyMap<string, RouteHandler> }>;

/**
 * The hosted MCP endpoint: the Streamable HTTP transport, OAuth discovery, registration
 * and token exchange, CORS, and the reaper that bounds abandoned state. It answers in data;
 * the raw HTTP door writes the answer and the access log line.
 */
export class McpEndpointService implements McpHandler {
  readonly #answers: McpAnswerService;
  readonly #auth: McpCallerAuthService;
  readonly #oauthTokens: McpOAuthTokenService;
  readonly #sessions: McpSessionService;
  readonly #oauth: McpOAuthEndpointService;
  readonly #routes: ReadonlyMap<string, RouteVerbs>;
  readonly #reaper: ReturnType<typeof setInterval>;
  readonly #keepalive: ReturnType<typeof setInterval>;

  private constructor(collaborators: McpEndpointCollaborators) {
    const answers = McpAnswerService.create({ baseHost: collaborators.baseHost });
    this.#answers = answers;
    this.#oauthTokens = McpOAuthTokenService.create({
      repository: collaborators.oauthTokenRecords,
      issuer: collaborators.cliSessions,
    });
    const auth = McpCallerAuthService.create({
      ...collaborators,
      answers,
    });
    this.#auth = auth;
    this.#sessions = McpSessionService.create({
      records: collaborators.sessionRecords,
      sessionTools: collaborators.sessionTools,
    });
    this.#oauth = McpOAuthEndpointService.create({
      answers,
      auth,
      oauthTokens: this.#oauthTokens,
      clients: collaborators.oauthClients,
    });
    this.#routes = this.#routeTable(
      McpStreamableTransportService.create({ answers, auth, sessions: this.#sessions }),
    );
    this.#reaper = setInterval(() => this.#reap(), REAPER_INTERVAL_MS);
    this.#keepalive = setInterval(() => this.#sessions.pingOpenStreams(), KEEPALIVE_INTERVAL_MS);
    // The process may exit while either timer is still scheduled.
    this.#reaper.unref();
    this.#keepalive.unref();
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

  answer = async (doorRequest: McpDoorRequest): Promise<McpDoorReply> => {
    const pathname = doorRequest.url.split("?")[0] ?? "";
    const method = doorRequest.method;
    // Only identifiers go in: MCP requests never reach the Hono stack's own access log.
    const identifiers: Record<string, string> = {};
    const request: McpRequest = {
      ...doorRequest,
      noteLogFields: (fields) => {
        for (const [key, value] of Object.entries(fields)) {
          if (value) identifiers[key] = value;
        }
      },
    };
    const headerSessionId = doorRequest.headers["mcp-session-id"];
    if (typeof headerSessionId === "string") request.noteLogFields({ sessionId: headerSessionId });

    const answer = await this.#answerRequest({ request, pathname, method });
    const accessLog = { ...accessLogOf({ request, pathname, method }), ...identifiers };
    return { answer, accessLog };
  };

  answerFailure = (input: { error: unknown; url: string }): McpDoorAnswer =>
    this.#answers.failure(input);

  /** Runs a stream answer's work as its session's key. */
  readonly sessionRunner: McpSessionRunner = {
    runAs: (apiKey, work) => this.#sessions.runAs(apiKey, work),
  };

  holdsSession = (sessionId: string): boolean => this.#sessions.streamable.has(sessionId);

  clearTokenCache = (): void => {
    this.#auth.clearGrantChecks();
  };

  clearRateLimiters = (): void => {
    this.#oauth.clearRateLimiters();
    this.#auth.clearRateLimiter();
  };

  closeAllSessions = async (): Promise<void> => {
    clearInterval(this.#reaper);
    clearInterval(this.#keepalive);
    await this.#sessions.closeAll();
  };

  async #answerRequest(input: {
    request: McpRequest;
    pathname: string;
    method: string;
  }): Promise<McpDoorAnswer> {
    if (input.method === "OPTIONS" && isMcpRoute(input.pathname)) return this.#answers.preflight();
    try {
      return await this.#dispatch(input);
    } catch (error: unknown) {
      return this.answerFailure({ error, url: input.request.url });
    }
  }

  async #dispatch(input: {
    request: McpRequest;
    pathname: string;
    method: string;
  }): Promise<McpDoorAnswer> {
    const { request, pathname, method } = input;
    // RFC 9728 path-suffixed discovery, tried before the bare form by every current MCP client.
    const metadata = this.#answerMetadataSubtree({ pathname, method });
    if (metadata) return metadata;

    const verbs = this.#routes.get(pathname);
    if (!verbs) return this.#answers.refusal(new McpRouteNotFoundError());
    const handle = "anyMethod" in verbs ? verbs.anyMethod : verbs.byMethod.get(method);
    if (!handle) return this.#answers.refusal(new McpMethodNotAllowedError());
    return handle(request);
  }

  #routeTable(streamable: McpStreamableTransportService): ReadonlyMap<string, RouteVerbs> {
    const oauth = this.#oauth;
    const only = (method: string, handler: RouteHandler): RouteVerbs => ({
      byMethod: new Map([[method, handler]]),
    });
    const streamableVerbs: RouteVerbs = {
      byMethod: new Map<string, RouteHandler>([
        ["POST", (request) => streamable.answerPost(request)],
        ["GET", (request) => streamable.answerGet(request)],
        ["DELETE", (request) => streamable.answerDelete(request)],
      ]),
    };
    return new Map<string, RouteVerbs>([
      ["/mcp/health", { anyMethod: () => this.#answers.json(200, { status: "ok" }) }],
      [
        PROTECTED_RESOURCE_METADATA_PATH,
        only("GET", () => oauth.answerProtectedResourceMetadata()),
      ],
      [
        AUTHORIZATION_SERVER_METADATA_PATH,
        only("GET", () => oauth.answerAuthorizationServerMetadata()),
      ],
      // Not an OpenID provider: claimed so the probe gets a JSON 404 rather than the app.
      ["/.well-known/openid-configuration", { anyMethod: () => oauth.answerUnpublishedMetadata() }],
      ["/oauth/register", only("POST", (request) => oauth.answerRegister(request))],
      ["/oauth/token", only("POST", (request) => oauth.answerToken(request))],
      ["/mcp", streamableVerbs],
      // The SSE transport is retired; a client still configured with its URL is served the
      // Streamable HTTP transport there.
      ["/sse", streamableVerbs],
    ]);
  }

  /** The answer for a path-suffixed discovery subtree, or undefined outside every subtree. */
  #answerMetadataSubtree(input: { pathname: string; method: string }): McpDoorAnswer | undefined {
    const path = classifyMetadataSubtreePath(input.pathname);
    if (path.kind === "outside") return undefined;
    if (input.method !== "GET") return this.#answers.refusal(new McpMethodNotAllowedError());
    if (path.kind === "unpublished") return this.#oauth.answerUnpublishedMetadata();
    if (path.kind === "protected-resource") {
      return this.#oauth.answerProtectedResourceMetadata(path.resourceSuffix);
    }
    return this.#oauth.answerAuthorizationServerMetadata();
  }

  /** Bounds the memory of abandoned sessions and stale probes. */
  #reap(): void {
    const now = nowInstant().epochMilliseconds;
    this.#sessions.reapIdle(now);
    this.#auth.sweep(now);
    this.#oauth.sweep();
  }
}

/** What was asked and who asked: the request half of its access log line. */
function accessLogOf(input: {
  request: McpRequest;
  pathname: string;
  method: string;
}): McpDoorAccessLog {
  const { request } = input;
  const base = { method: input.method, path: input.pathname };
  try {
    const userAgent = request.headers["user-agent"] ?? null;
    return {
      ...base,
      userAgent,
      endpointClass: endpointClassOf(input.pathname),
      ...classifyClient((name) => {
        const value = request.headers[name];
        return typeof value === "string" ? value : value?.[0];
      }),
    };
  } catch {
    // Logging must not break request handling.
    return base;
  }
}
