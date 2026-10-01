import type { IncomingMessage, ServerResponse } from "node:http";

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { McpOAuthClientRepository } from "../repositories/mcp-oauth-client.repository.ts";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  extractClientIdFromBasicAuth,
  parseFormBody,
} from "../rules/mcp-routes.rules.ts";
import type { McpCallerAuthService } from "./mcp-caller-auth.service.ts";
import type { McpHttpService } from "./mcp-http.service.ts";
import type { McpOAuthTokenService } from "./mcp-oauth-token.service.ts";
import { McpRateLimitService } from "./mcp-rate-limit.service.ts";

const logger = createLogger("langwatch:mcp");

/** Entropy source; never read back by kind. */
const OAUTH_CLIENT_KSUID_RESOURCE = "mcp";

/** RFC 7591: redirect_uris is required for the authorization_code grant. */
const registrationSchema = z.object({
  redirect_uris: z.array(z.string()).min(1),
  client_name: z.unknown().optional(),
});

type McpOAuthEndpointCollaborators = Readonly<{
  http: McpHttpService;
  auth: McpCallerAuthService;
  oauthTokens: McpOAuthTokenService;
  clients: McpOAuthClientRepository;
}>;

/**
 * OAuth 2.1 discovery, dynamic client registration and token exchange for MCP clients. Each of
 * registration and exchange gets its own budget: a client that just registered exchanges a code
 * at once, and one shared bucket would make the second call pay for the first.
 */
export class McpOAuthEndpointService {
  readonly #collaborators: McpOAuthEndpointCollaborators;
  readonly #registerLimiter = McpRateLimitService.create({ windowMs: 60_000, maxRequests: 30 });
  readonly #tokenLimiter = McpRateLimitService.create({ windowMs: 60_000, maxRequests: 30 });

  private constructor(collaborators: McpOAuthEndpointCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(collaborators: McpOAuthEndpointCollaborators): McpOAuthEndpointService {
    return new McpOAuthEndpointService(collaborators);
  }

  handleProtectedResourceMetadata(res: ServerResponse, resourceSuffix = ""): void {
    const { http } = this.#collaborators;
    http.sendJson(res, 200, buildProtectedResourceMetadata(http.baseHost, resourceSuffix));
  }

  handleAuthorizationServerMetadata(res: ServerResponse): void {
    const { http } = this.#collaborators;
    http.sendJson(res, 200, buildAuthorizationServerMetadata(http.baseHost));
  }

  /**
   * The discovery subtree this server claims but publishes nothing at. Falling through to the
   * single-page app would answer 200 text/html; a JSON 404 lets the client move on.
   */
  handleUnpublishedMetadata(res: ServerResponse): void {
    this.#collaborators.http.sendJson(res, 404, {
      error: "not_found",
      error_description: "No metadata document is published at this path",
    });
  }

  /**
   * Any registration succeeds; what matters is binding the client_id to the redirect_uris it
   * registered, so `/mcp/authorize` can refuse a request that later names a different one.
   */
  async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http } = this.#collaborators;
    if (this.#isThrottled({ limiter: this.#registerLimiter, req, res })) return;

    const read = await http.readRawBody(req, res);
    if (read.kind === "answered") return;

    let document: unknown;
    try {
      document = JSON.parse(read.body);
    } catch {
      http.sendJson(res, 400, { error: "invalid_client_metadata" });
      return;
    }
    const registration = registrationSchema.safeParse(document);
    if (!registration.success) {
      http.sendJson(res, 400, {
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required",
      });
      return;
    }

    const redirectUris = registration.data.redirect_uris;
    const clientName =
      typeof registration.data.client_name === "string"
        ? registration.data.client_name
        : "MCP Client";
    const clientId = generate(OAUTH_CLIENT_KSUID_RESOURCE).toString();
    try {
      await this.#collaborators.clients.register({
        clientId,
        client: { redirectUris, clientName },
      });
    } catch (err) {
      logger.error({ error: err }, "Failed to persist OAuth client registration");
      http.sendJson(res, 500, { error: "server_error" });
      return;
    }

    http.noteLogFields(res, { clientId });
    http.sendJson(res, 201, {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  }

  async handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { http } = this.#collaborators;
    if (this.#isThrottled({ limiter: this.#tokenLimiter, req, res })) return;

    const read = await http.readRawBody(req, res);
    if (read.kind === "answered") return;
    const params = parseFormBody(read.body);
    const clientId =
      params.client_id ?? extractClientIdFromBasicAuth(req.headers.authorization) ?? null;
    if (clientId) http.noteLogFields(res, { clientId });

    const exchange = await this.#collaborators.oauthTokens.redeem({
      grantType: params.grant_type,
      code: params.code,
      codeVerifier: params.code_verifier,
      redirectUri: params.redirect_uri,
      clientId,
    });
    http.sendJson(res, exchange.status, exchange.body);
  }

  sweep(): void {
    this.#registerLimiter.sweep();
    this.#tokenLimiter.sweep();
  }

  clearRateLimiters(): void {
    this.#registerLimiter.clear();
    this.#tokenLimiter.clear();
  }

  /** Counts this call against the caller's budget, answering 429 when it is already spent. */
  #isThrottled(input: {
    limiter: McpRateLimitService;
    req: IncomingMessage;
    res: ServerResponse;
  }): boolean {
    const ip = this.#collaborators.auth.clientIpOf(input.req);
    if (input.limiter.isBlocked(ip)) {
      this.#collaborators.http.sendRateLimited(input.res);
      return true;
    }
    input.limiter.track(ip);
    return false;
  }
}
