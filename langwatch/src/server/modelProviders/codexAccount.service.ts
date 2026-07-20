import { createLogger } from "@langwatch/observability";
import {
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_ISSUER,
  CODEX_VERIFICATION_URL,
  type CodexTokenKeys,
  codexTokenKeysSchema,
} from "./codexAccount.schema";

/**
 * Sign in with your OpenAI account for the Codex provider, so requests bill
 * the user's ChatGPT plan instead of API credits. This is OpenAI's own
 * device-code flow, the one the codex CLI ships (and the same client id, so
 * approvals land on OpenAI's official "Codex CLI" grant screen):
 *
 *   1. POST {auth}/api/accounts/deviceauth/usercode {client_id}
 *      -> {device_auth_id, user_code, interval}
 *   2. The user opens {auth}/codex/device and enters the one-time code.
 *   3. Poll POST {auth}/api/accounts/deviceauth/token {device_auth_id,
 *      user_code}; 403/404 = still pending; success returns a server-made
 *      PKCE pair + authorization code.
 *   4. POST {auth}/oauth/token (form) -> id/access/refresh tokens.
 *
 * The id token's `https://api.openai.com/auth` claim carries the ChatGPT
 * account id (sent as a header on every codex request) and the plan.
 *
 * Spec: specs/model-providers/codex-account-provider.feature
 */

const logger = createLogger("langwatch:modelProviders:codexAccount");

export interface CodexDeviceCode {
  userCode: string;
  deviceAuthId: string;
  /** Seconds the caller should wait between polls. */
  intervalSeconds: number;
  verificationUrl: string;
}

/** One poll's outcome: still waiting, or a full token set. */
export type CodexPollResult =
  | { status: "pending" }
  | { status: "complete"; keys: CodexTokenKeys };

export class CodexAuthError extends Error {
  constructor(
    public readonly kind:
      | "http"
      | "malformed"
      | "timed_out"
      | "refresh_rejected",
    message: string,
  ) {
    super(message);
    this.name = "CodexAuthError";
  }
}

interface CodexOAuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * The device-flow + token-lifecycle engine. Stateless: the pending sign-in's
 * identifiers travel to the client and come back on every poll, so a poll can
 * land on any server instance.
 */
export class CodexAccountService {
  private readonly issuer: string;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    issuer?: string,
  ) {
    // The env override exists for tests (a local stand-in issuer) and for
    // debugging against a staging identity service; production always runs
    // on the real issuer.
    this.issuer =
      issuer ?? process.env.CODEX_OAUTH_ISSUER ?? CODEX_OAUTH_ISSUER;
  }

  async startDeviceSignIn(): Promise<CodexDeviceCode> {
    const json = await this.postJson(
      `${this.issuer}/api/accounts/deviceauth/usercode`,
      { client_id: CODEX_OAUTH_CLIENT_ID },
    );
    const deviceAuthId = json.device_auth_id;
    const userCode = json.user_code ?? json.usercode;
    if (typeof deviceAuthId !== "string" || typeof userCode !== "string") {
      throw new CodexAuthError("malformed", "device code fields missing");
    }
    const interval =
      typeof json.interval === "number"
        ? json.interval
        : typeof json.interval === "string"
          ? Number(json.interval)
          : 5;
    return {
      userCode,
      deviceAuthId,
      intervalSeconds: Math.max(2, Number.isFinite(interval) ? interval : 5),
      verificationUrl: CODEX_VERIFICATION_URL,
    };
  }

  /**
   * One poll of the pending sign-in. 403/404 from the endpoint mean "the user
   * hasn't approved yet" — reported as pending, never as failure. Approval
   * returns the server-made PKCE pair, which is exchanged for tokens
   * immediately (the authorization code is single-use).
   */
  async pollDeviceSignIn(args: {
    deviceAuthId: string;
    userCode: string;
  }): Promise<CodexPollResult> {
    let json: Record<string, unknown>;
    try {
      json = await this.postJson(
        `${this.issuer}/api/accounts/deviceauth/token`,
        { device_auth_id: args.deviceAuthId, user_code: args.userCode },
      );
    } catch (error) {
      if (
        error instanceof CodexAuthError &&
        error.kind === "http" &&
        /^HTTP (403|404)/.test(error.message)
      ) {
        return { status: "pending" };
      }
      throw error;
    }
    const code = json.authorization_code;
    const verifier = json.code_verifier;
    if (typeof code !== "string" || typeof verifier !== "string") {
      throw new CodexAuthError("malformed", "token poll fields missing");
    }
    const tokens = await this.exchangeCode(code, verifier);
    return { status: "complete", keys: this.toKeys(tokens) };
  }

  /**
   * Refresh an expired access token. A rejection here means the session is
   * genuinely dead (revoked, or the refresh token aged out) and the user must
   * sign in again — callers surface that, they don't retry.
   */
  async refresh(keys: CodexTokenKeys): Promise<CodexTokenKeys> {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: keys.CODEX_REFRESH_TOKEN,
      client_id: CODEX_OAUTH_CLIENT_ID,
      scope: "openid profile email offline_access",
    });
    let json: Record<string, unknown>;
    try {
      json = await this.postForm(`${this.issuer}/oauth/token`, form);
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "codex token refresh rejected",
      );
      throw new CodexAuthError(
        "refresh_rejected",
        "OpenAI session expired; sign in again",
      );
    }
    const tokens = this.parseTokens(json, {
      idToken: keys.CODEX_ID_TOKEN,
      refreshToken: keys.CODEX_REFRESH_TOKEN,
    });
    return this.toKeys(tokens);
  }

  private async exchangeCode(
    code: string,
    verifier: string,
  ): Promise<CodexOAuthTokens> {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${this.issuer}/deviceauth/callback`,
      client_id: CODEX_OAUTH_CLIENT_ID,
      code_verifier: verifier,
    });
    const json = await this.postForm(`${this.issuer}/oauth/token`, form);
    return this.parseTokens(json);
  }

  private parseTokens(
    json: Record<string, unknown>,
    fallback?: { idToken: string; refreshToken: string },
  ): CodexOAuthTokens {
    const accessToken = json.access_token;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      throw new CodexAuthError("malformed", "no access_token in response");
    }
    return {
      accessToken,
      idToken:
        typeof json.id_token === "string" && json.id_token.length > 0
          ? json.id_token
          : (fallback?.idToken ?? ""),
      refreshToken:
        typeof json.refresh_token === "string" && json.refresh_token.length > 0
          ? json.refresh_token
          : (fallback?.refreshToken ?? ""),
    };
  }

  private toKeys(tokens: CodexOAuthTokens): CodexTokenKeys {
    const claims = decodeCodexClaims(tokens.idToken);
    return {
      CODEX_ACCESS_TOKEN: tokens.accessToken,
      CODEX_REFRESH_TOKEN: tokens.refreshToken,
      CODEX_ID_TOKEN: tokens.idToken,
      CODEX_ACCOUNT_ID: claims.accountId,
      CODEX_PLAN: claims.plan,
      CODEX_EMAIL: claims.email,
      CODEX_TOKENS_SAVED_AT: new Date().toISOString(),
    };
  }

  private async postJson(
    url: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async postForm(
    url: string,
    form: URLSearchParams,
  ): Promise<Record<string, unknown>> {
    return this.send(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  }

  private async send(
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    if (!response.ok) {
      throw new CodexAuthError(
        "http",
        `HTTP ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new CodexAuthError("malformed", "non-JSON auth response");
    }
  }
}

/**
 * The gateway's 401 recovery: refresh a provider row's stored tokens and
 * hand back a fresh access token, persisting the rotation. A row refreshed
 * within the last few seconds is returned as-is instead of refreshed again,
 * so a burst of concurrent 401s (one per in-flight request) collapses into
 * one issuer round-trip and can't burn a one-time refresh token twice.
 */
export class CodexGatewayRefreshService {
  /** A token this fresh is the one we just minted — don't refresh again. */
  static readonly JUST_REFRESHED_WINDOW_MS = 30_000;

  constructor(
    private readonly repository: {
      findByIdWithDecryptedKeys: (
        id: string,
      ) => Promise<{ provider: string; customKeys: unknown } | null>;
      replaceCustomKeys: (args: {
        id: string;
        customKeys: Record<string, unknown>;
      }) => Promise<void>;
    },
    private readonly engine: CodexAccountService = new CodexAccountService(),
  ) {}

  async refreshForGateway(
    providerRowId: string,
  ): Promise<
    | { status: "refreshed"; accessToken: string; accountId: string }
    | { status: "not_connected" }
    | { status: "session_expired" }
  > {
    const row = await this.repository.findByIdWithDecryptedKeys(providerRowId);
    if (!row || row.provider !== "openai_codex") {
      return { status: "not_connected" };
    }
    const parsed = codexTokenKeysSchema.safeParse(row.customKeys ?? {});
    if (!parsed.success) return { status: "not_connected" };
    const keys = parsed.data;

    const savedAtMs = Date.parse(keys.CODEX_TOKENS_SAVED_AT);
    if (
      Number.isFinite(savedAtMs) &&
      Date.now() - savedAtMs <
        CodexGatewayRefreshService.JUST_REFRESHED_WINDOW_MS
    ) {
      return {
        status: "refreshed",
        accessToken: keys.CODEX_ACCESS_TOKEN,
        accountId: keys.CODEX_ACCOUNT_ID,
      };
    }

    let refreshed: CodexTokenKeys;
    try {
      refreshed = await this.engine.refresh(keys);
    } catch (error) {
      if (
        error instanceof CodexAuthError &&
        error.kind === "refresh_rejected"
      ) {
        return { status: "session_expired" };
      }
      throw error;
    }
    await this.repository.replaceCustomKeys({
      id: providerRowId,
      customKeys: refreshed,
    });
    return {
      status: "refreshed",
      accessToken: refreshed.CODEX_ACCESS_TOKEN,
      accountId: refreshed.CODEX_ACCOUNT_ID,
    };
  }
}

export interface CodexClaims {
  accountId: string;
  email: string;
  plan: string;
}

/** Account id, email and plan from the id-token JWT (no verification —
 *  the token came straight from the issuer over TLS and is only used for
 *  display + the account-id request header, exactly as the codex CLI does). */
export function decodeCodexClaims(idToken: string): CodexClaims {
  const parts = idToken.split(".");
  const payload = parts[1];
  if (!payload) return { accountId: "", email: "", plan: "" };
  try {
    const json = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const auth = (json["https://api.openai.com/auth"] ?? {}) as Record<
      string,
      unknown
    >;
    return {
      accountId:
        typeof auth.chatgpt_account_id === "string"
          ? auth.chatgpt_account_id
          : "",
      email: typeof json.email === "string" ? json.email : "",
      plan:
        typeof auth.chatgpt_plan_type === "string"
          ? auth.chatgpt_plan_type
          : "",
    };
  } catch {
    return { accountId: "", email: "", plan: "" };
  }
}
