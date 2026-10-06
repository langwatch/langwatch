/**
 * The hosted MCP token endpoint's decisions: whether an authorization code or a refresh token can
 * become a session. The session itself, a person-bound access token capped at the approved
 * project plus a rotating refresh token, is minted by the auth module, as for the CLI.
 */
import { createHash } from "node:crypto";

import type { AuthApi } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { McpOAuthTokenRepository } from "../repositories/mcp-oauth-token.repository.ts";

const logger = createLogger("langwatch:mcp");

/** The label a hosted MCP sign-in carries in the person's session inventory. */
const MCP_CLIENT_LABEL = "Hosted MCP";

type OAuthError = Readonly<{
  error: string;
  error_description?: string;
}>;

type McpOAuthTokenExchange =
  | Readonly<{
      status: 200;
      body: Readonly<{
        access_token: string;
        token_type: "Bearer";
        expires_in: number;
        refresh_token: string;
      }>;
    }>
  | Readonly<{ status: 400 | 401 | 500; body: OAuthError }>;

/** The OAuth form values after the raw Node transport has decoded them. */
type McpOAuthTokenRequest = Readonly<{
  grantType: string | undefined;
  code: string | undefined;
  codeVerifier: string | undefined;
  redirectUri: string | undefined;
  refreshToken: string | undefined;
  clientId: string | null;
}>;

/** What the hosted MCP asks auth for: issue, rotate and read the sessions it answers. */
export type McpCliSessions = Pick<
  AuthApi,
  "issueProjectCliSession" | "refreshCliSession" | "getCliAccessSession"
>;

/** Owns the authorization-code and refresh-token exchanges. */
export class McpOAuthTokenService {
  readonly #repository: McpOAuthTokenRepository;
  readonly #issuer: McpCliSessions;

  private constructor({
    repository,
    issuer,
  }: {
    repository: McpOAuthTokenRepository;
    issuer: McpCliSessions;
  }) {
    this.#repository = repository;
    this.#issuer = issuer;
  }

  static create({
    repository,
    issuer,
  }: {
    repository: McpOAuthTokenRepository;
    issuer: McpCliSessions;
  }): McpOAuthTokenService {
    return new McpOAuthTokenService({ repository, issuer });
  }

  async redeem(request: McpOAuthTokenRequest): Promise<McpOAuthTokenExchange> {
    if (request.grantType === "refresh_token") return this.#refresh(request);
    if (request.grantType !== "authorization_code") {
      return {
        status: 400,
        body: {
          error: "unsupported_grant_type",
          error_description: "Only authorization_code and refresh_token grant types are supported",
        },
      };
    }
    return this.#exchangeCode(request);
  }

  async #refresh(request: McpOAuthTokenRequest): Promise<McpOAuthTokenExchange> {
    if (!request.refreshToken) return this.#invalidRequest("refresh_token is required");
    try {
      return this.#granted(
        await this.#issuer.refreshCliSession({ refreshToken: request.refreshToken }),
      );
    } catch (error) {
      if (!HandledError.isHandled(error)) {
        logger.error({ error }, "MCP refresh failed");
        return { status: 500, body: { error: "server_error" } };
      }
      return this.#invalidGrant("Refresh token is invalid, expired or revoked");
    }
  }

  async #exchangeCode(request: McpOAuthTokenRequest): Promise<McpOAuthTokenExchange> {
    const invalidRequest = this.#invalidCodeRequestFor(request);
    if (invalidRequest) return invalidRequest;

    if (!this.#repository.isAvailable()) return { status: 500, body: { error: "server_error" } };

    const code = request.code!;
    const clientId = request.clientId!;
    const codeVerifier = request.codeVerifier!;
    const redirectUri = request.redirectUri!;
    let consumed;
    try {
      consumed = await this.#repository.consumeAuthorizationCode({ code });
    } catch (error) {
      logger.error({ error }, "Redis auth code lookup failed");
      return { status: 500, body: { error: "server_error" } };
    }

    if (consumed.kind === "corrupted") return this.#invalidGrant("Corrupted authorization code");
    if (consumed.kind === "missing") return this.#missingCode({ clientId });
    const { record: stored } = consumed;
    if (stored.redirectUri !== redirectUri) {
      return this.#invalidGrant("redirect_uri does not match the authorization request");
    }
    if (stored.clientId !== clientId) {
      return this.#invalidGrant("client_id does not match the authorization request");
    }
    if (nowInstant().epochMilliseconds >= stored.expiresAt) {
      return this.#invalidGrant("Authorization code has expired");
    }

    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    if (challenge !== stored.codeChallenge) {
      return this.#invalidGrant("PKCE code_verifier does not match code_challenge");
    }

    try {
      return this.#granted(
        await this.#issuer.issueProjectCliSession({
          userId: stored.userId,
          organizationId: stored.organizationId,
          projectId: stored.projectId,
          clientLabel: MCP_CLIENT_LABEL,
        }),
      );
    } catch (error) {
      // Auth refuses when the approver has since lost the project or the organization.
      if (HandledError.isHandled(error)) return this.#invalidGrant("Access to the project ended");
      logger.error({ error }, "MCP session issue failed");
      return { status: 500, body: { error: "server_error" } };
    }
  }

  #granted(
    session: Awaited<ReturnType<McpCliSessions["issueProjectCliSession"]>>,
  ): McpOAuthTokenExchange {
    return {
      status: 200,
      body: {
        access_token: session.accessToken,
        token_type: "Bearer",
        expires_in: session.accessTtlSeconds,
        refresh_token: session.refreshToken,
      },
    };
  }

  #invalidCodeRequestFor(request: McpOAuthTokenRequest): McpOAuthTokenExchange | null {
    if (!request.code) return this.#invalidRequest("code is required");
    if (!request.codeVerifier) return this.#invalidRequest("code_verifier is required");
    if (!request.redirectUri) return this.#invalidRequest("redirect_uri is required");
    if (!request.clientId) return this.#invalidRequest("client_id is required");
    return null;
  }

  async #missingCode({ clientId }: { clientId: string }): Promise<McpOAuthTokenExchange> {
    const registered = await this.#repository.hasRegisteredClient({ clientId }).catch(() => false);
    if (!registered) {
      return {
        status: 401,
        body: {
          error: "invalid_client",
          error_description: "Unknown client_id — register again via dynamic client registration",
        },
      };
    }
    return this.#invalidGrant("Invalid or expired authorization code");
  }

  #invalidRequest(description: string): McpOAuthTokenExchange {
    return { status: 400, body: { error: "invalid_request", error_description: description } };
  }

  #invalidGrant(description: string): McpOAuthTokenExchange {
    return { status: 400, body: { error: "invalid_grant", error_description: description } };
  }
}
