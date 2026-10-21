import { type McpDoorAnswer, McpMetadataUnpublishedError } from "@langwatch/hosted-mcp-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { McpOAuthClientRepository } from "../repositories/mcp-oauth-client.repository.ts";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  extractClientIdFromBasicAuth,
  parseFormBody,
  extractSingleHeader,
} from "../rules/mcp-routes.rules.ts";
import type { McpAnswerService, McpRequest } from "./mcp-answer.service.ts";
import type { McpCallerAuthService } from "./mcp-caller-auth.service.ts";
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
  answers: McpAnswerService;
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

  answerProtectedResourceMetadata(resourceSuffix = ""): McpDoorAnswer {
    const { answers } = this.#collaborators;
    return answers.json(200, buildProtectedResourceMetadata(answers.baseHost, resourceSuffix));
  }

  answerAuthorizationServerMetadata(): McpDoorAnswer {
    const { answers } = this.#collaborators;
    return answers.json(200, buildAuthorizationServerMetadata(answers.baseHost));
  }

  /**
   * The discovery subtree this server claims but publishes nothing at. Falling through to the
   * single-page app would answer 200 text/html; a JSON 404 lets the client move on.
   */
  answerUnpublishedMetadata(): McpDoorAnswer {
    return this.#collaborators.answers.refusal(new McpMetadataUnpublishedError());
  }

  /**
   * Any registration succeeds; what matters is binding the client_id to the redirect_uris it
   * registered, so `/mcp/authorize` can refuse a request that later names a different one.
   */
  async answerRegister(request: McpRequest): Promise<McpDoorAnswer> {
    const { answers } = this.#collaborators;
    const throttled = this.#throttle({ limiter: this.#registerLimiter, request });
    if (throttled) return throttled;

    const read = await answers.readRawBody(request);
    if (read.kind === "answered") return read.answer;

    let document: unknown;
    try {
      document = JSON.parse(read.body);
    } catch {
      return answers.json(400, { error: "invalid_client_metadata" });
    }
    const registration = registrationSchema.safeParse(document);
    if (!registration.success) {
      return answers.json(400, {
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required",
      });
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
      return answers.json(500, { error: "server_error" });
    }

    request.noteLogFields({ clientId });
    return answers.json(201, {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  }

  async answerToken(request: McpRequest): Promise<McpDoorAnswer> {
    const { answers } = this.#collaborators;
    const throttled = this.#throttle({ limiter: this.#tokenLimiter, request });
    if (throttled) return throttled;

    const read = await answers.readRawBody(request);
    if (read.kind === "answered") return read.answer;
    const params = parseFormBody(read.body);
    const clientId =
      params.client_id ??
      extractClientIdFromBasicAuth(extractSingleHeader(request.headers.authorization)) ??
      null;
    if (clientId) request.noteLogFields({ clientId });

    const exchange = await this.#collaborators.oauthTokens.redeem({
      grantType: params.grant_type,
      code: params.code,
      codeVerifier: params.code_verifier,
      redirectUri: params.redirect_uri,
      refreshToken: params.refresh_token,
      clientId,
    });
    return answers.json(exchange.status, exchange.body);
  }

  sweep(): void {
    this.#registerLimiter.sweep();
    this.#tokenLimiter.sweep();
  }

  clearRateLimiters(): void {
    this.#registerLimiter.clear();
    this.#tokenLimiter.clear();
  }

  /** Counts this call against the caller's budget; the 429 to answer when it is already spent. */
  #throttle(input: {
    limiter: McpRateLimitService;
    request: McpRequest;
  }): McpDoorAnswer | undefined {
    const ip = this.#collaborators.auth.clientIpOf(input.request);
    if (input.limiter.isBlocked(ip)) return this.#collaborators.answers.rateLimited();
    input.limiter.track(ip);
    return undefined;
  }
}
