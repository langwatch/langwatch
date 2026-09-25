/**
 * OAuth bearer issuance and resolution for the hosted MCP endpoint. This
 * service owns the durable token/code records and the protocol checks that
 * decide whether an authorization code can become an MCP bearer.
 */
import { createHash } from "node:crypto";

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { McpApiKeyCipher } from "../app/hosted-mcp-members.ts";
import type { McpOAuthTokenRepository } from "../repositories/mcp-oauth-token.repository.ts";

const logger = createLogger("langwatch:mcp");

const TOKEN_TTL_SECONDS = 30 * 24 * 3600;
const OAUTH_TOKEN_ENTROPY_KSUID_RESOURCE = "mcptoken";

type OAuthTokenEntry = Readonly<{
  apiKey: string;
  userId: string | undefined;
  expiresAt: number;
}>;

type OAuthError = Readonly<{
  error: string;
  error_description?: string;
}>;

export type McpOAuthTokenExchange =
  | Readonly<{
      status: 200;
      body: Readonly<{ access_token: string; token_type: "Bearer"; expires_in: number }>;
    }>
  | Readonly<{ status: 400 | 401 | 500; body: OAuthError }>;

/** A bearer read: the session it opens, or an expired or unreadable token the caller refuses. */
export type McpOAuthSessionLookup =
  | { kind: "session"; context: McpOAuthSessionContext }
  | { kind: "refused" };

export type McpOAuthSessionContext = Readonly<{
  apiKey: string;
  userId: string | undefined;
}>;

/** The OAuth form values after the raw Node transport has decoded them. */
export type McpOAuthTokenRequest = Readonly<{
  grantType: string | undefined;
  code: string | undefined;
  codeVerifier: string | undefined;
  redirectUri: string | undefined;
  clientId: string | null;
}>;

/** Owns the cached bearer state and the authorization-code exchange. */
export class McpOAuthTokenService {
  readonly #repository: McpOAuthTokenRepository;
  readonly #cipher: McpApiKeyCipher;
  readonly #tokens = new Map<string, OAuthTokenEntry>();

  private constructor({
    repository,
    cipher,
  }: {
    repository: McpOAuthTokenRepository;
    cipher: McpApiKeyCipher;
  }) {
    this.#repository = repository;
    this.#cipher = cipher;
  }

  static create({
    repository,
    cipher,
  }: {
    repository: McpOAuthTokenRepository;
    cipher: McpApiKeyCipher;
  }): McpOAuthTokenService {
    return new McpOAuthTokenService({ repository, cipher });
  }

  async redeem(request: McpOAuthTokenRequest): Promise<McpOAuthTokenExchange> {
    const invalidRequest = this.#invalidRequestFor(request);
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

    const apiKey = this.#cipher.decrypt(stored.encryptedApiKey);
    const accessToken = this.#generateAccessToken();
    await this.#store({ accessToken, apiKey, userId: stored.userId });

    return {
      status: 200,
      body: { access_token: accessToken, token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS },
    };
  }

  async resolve(token: string): Promise<McpOAuthSessionLookup> {
    const cached = this.#tokens.get(token);
    if (cached) {
      if (nowInstant().epochMilliseconds < cached.expiresAt) {
        return { kind: "session", context: { apiKey: cached.apiKey, userId: cached.userId } };
      }
      this.#tokens.delete(token);
      return { kind: "refused" };
    }

    try {
      const found = await this.#repository.findBearer({ token });
      if (found.kind === "missing")
        return { kind: "session", context: { apiKey: token, userId: void 0 } };
      if (found.kind === "corrupted") {
        await this.#repository.removeBearer({ token });
        return { kind: "refused" };
      }

      const { record: stored } = found;
      if (nowInstant().epochMilliseconds < stored.expiresAt) {
        const apiKey = this.#cipher.decrypt(stored.encryptedApiKey);
        this.#tokens.set(token, { apiKey, userId: stored.userId, expiresAt: stored.expiresAt });
        return { kind: "session", context: { apiKey, userId: stored.userId } };
      }
      await this.#repository.removeBearer({ token });
      return { kind: "refused" };
    } catch (error) {
      // Validation of the direct API key still follows this lookup, so a
      // Redis failure cannot admit a credential on its own.
      logger.error({ error }, "Redis token lookup failed");
    }

    return { kind: "session", context: { apiKey: token, userId: void 0 } };
  }

  clearCache(): void {
    this.#tokens.clear();
  }

  reapExpired(): void {
    const now = nowInstant().epochMilliseconds;
    for (const [token, entry] of this.#tokens) {
      if (now >= entry.expiresAt) this.#tokens.delete(token);
    }
  }

  #invalidRequestFor(request: McpOAuthTokenRequest): McpOAuthTokenExchange | null {
    if (request.grantType !== "authorization_code") {
      return {
        status: 400,
        body: {
          error: "unsupported_grant_type",
          error_description: "Only authorization_code grant type is supported",
        },
      };
    }
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

  #generateAccessToken(): string {
    return createHash("sha256")
      .update(generate(OAUTH_TOKEN_ENTROPY_KSUID_RESOURCE).toString())
      .digest("hex");
  }

  async #store({
    accessToken,
    apiKey,
    userId,
  }: {
    accessToken: string;
    apiKey: string;
    userId: string | undefined;
  }): Promise<void> {
    const expiresAt = nowInstant().epochMilliseconds + TOKEN_TTL_SECONDS * 1000;
    this.#tokens.set(accessToken, { apiKey, userId, expiresAt });

    try {
      await this.#repository.storeBearer({
        token: accessToken,
        record: { encryptedApiKey: this.#cipher.encrypt(apiKey), userId, expiresAt },
      });
    } catch (error) {
      logger.error({ error }, "Failed to store OAuth token in Redis");
    }
  }
}
