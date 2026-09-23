import {
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_ISSUER,
  CODEX_VERIFICATION_URL,
  CodexAuthError,
  type CodexTokenKeys,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { CodexTokenRefresher } from "../app/model-provider.members.ts";

/**
 * OpenAI's device-code flow (codex CLI's own client id) so requests bill the ChatGPT plan.
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
export type CodexPollResult = { status: "pending" } | { status: "complete"; keys: CodexTokenKeys };

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
  /** Account id, email and plan from the id-token JWT (no verification —
   *  the token came straight from the issuer over TLS and is only used for
   *  display + the account-id request header, exactly as the codex CLI does). */
  static decodeCodexClaims(idToken: string): CodexClaims {
    const parts = idToken.split(".");
    const payload = parts[1];
    if (!payload) return { accountId: "", email: "", plan: "" };
    try {
      const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
        string,
        unknown
      >;
      const auth = (json["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
      return {
        accountId: typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id : "",
        email: typeof json.email === "string" ? json.email : "",
        plan: typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : "",
      };
    } catch {
      return { accountId: "", email: "", plan: "" };
    }
  }

  private readonly issuer: string;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    issuer?: string,
  ) {
    // The override exists for tests (a local stand-in issuer) and for
    // debugging against a staging identity service; production always runs
    // on the real issuer, so the composing process passes nothing.
    this.issuer = issuer ?? CODEX_OAUTH_ISSUER;
  }

  async startDeviceSignIn(): Promise<CodexDeviceCode> {
    const json = await this.postJson(`${this.issuer}/api/accounts/deviceauth/usercode`, {
      client_id: CODEX_OAUTH_CLIENT_ID,
    });
    const deviceAuthId = json.device_auth_id;
    const userCode = json.user_code ?? json.usercode;
    if (typeof deviceAuthId !== "string" || typeof userCode !== "string") {
      throw new CodexAuthError("malformed", "device code fields missing");
    }
    const interval = pollIntervalOf(json.interval);
    return {
      userCode,
      deviceAuthId,
      intervalSeconds: Math.max(2, Number.isFinite(interval) ? interval : 5),
      verificationUrl: CODEX_VERIFICATION_URL,
    };
  }

  /** 403/404 mean "not approved yet" and report as pending, never as failure. */
  async pollDeviceSignIn(args: {
    deviceAuthId: string;
    userCode: string;
  }): Promise<CodexPollResult> {
    let json: Record<string, unknown>;
    try {
      json = await this.postJson(`${this.issuer}/api/accounts/deviceauth/token`, {
        device_auth_id: args.deviceAuthId,
        user_code: args.userCode,
      });
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
   * Only a confirmed `invalid_grant` rejection becomes `refresh_rejected`; a timeout or 5xx
   * stays retryable so an OpenAI outage never forces the user to re-authenticate.
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
      if (isTerminalOAuthRejection(error)) {
        logger.warn({ error: error.message }, "codex token refresh rejected by the issuer");
        throw new CodexAuthError("refresh_rejected", "OpenAI session expired; sign in again");
      }
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "codex token refresh failed transiently",
      );
      if (error instanceof CodexAuthError) throw error;
      // A raw fetch failure (DNS, timeout, reset) — wrap it so callers get
      // the same retryable HandledError shape as an issuer 5xx.
      throw new CodexAuthError("http", error instanceof Error ? error.message : String(error));
    }
    const tokens = this.parseTokens(json, {
      idToken: keys.CODEX_ID_TOKEN,
      refreshToken: keys.CODEX_REFRESH_TOKEN,
    });
    return this.toKeys(tokens);
  }

  private async exchangeCode(code: string, verifier: string): Promise<CodexOAuthTokens> {
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
    const claims = CodexAccountService.decodeCodexClaims(tokens.idToken);
    return {
      CODEX_ACCESS_TOKEN: tokens.accessToken,
      CODEX_REFRESH_TOKEN: tokens.refreshToken,
      CODEX_ID_TOKEN: tokens.idToken,
      CODEX_ACCOUNT_ID: claims.accountId,
      CODEX_PLAN: claims.plan,
      CODEX_EMAIL: claims.email,
      CODEX_TOKENS_SAVED_AT: nowInstant().toString({ fractionalSecondDigits: 3 }),
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

  private async postForm(url: string, form: URLSearchParams): Promise<Record<string, unknown>> {
    return this.send(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  }

  private async send(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    if (!response.ok) {
      throw new CodexAuthError("http", `HTTP ${response.status}: ${text.slice(0, 200)}`, {
        status: response.status,
      });
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new CodexAuthError("malformed", "non-JSON auth response");
    }
  }
}

/**
 * True only for the issuer's own rejection of the grant: a 4xx answer whose body names
 * `invalid_grant` (revoked session / rotated-away refresh token). Everything else — 5xx,
 * 429, network failures, malformed bodies — is a provider problem, not a dead session.
 */
function isTerminalOAuthRejection(error: unknown): error is CodexAuthError {
  return (
    error instanceof CodexAuthError &&
    error.kind === "http" &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    error.message.includes("invalid_grant")
  );
}

export interface CodexClaims {
  accountId: string;
  email: string;
  plan: string;
}

/**
 * The Codex refresher, over the device-flow account service above.
 */
export class CodexOAuthModelProviderTokenRefresherAdapter extends CodexTokenRefresher {
  static create(input: { issuer?: string } = {}): CodexOAuthModelProviderTokenRefresherAdapter {
    return new CodexOAuthModelProviderTokenRefresherAdapter(
      new CodexAccountService(fetch, input.issuer),
    );
  }

  private constructor(private readonly account: CodexAccountService) {
    super();
  }

  async refresh(input: {
    tokens: CodexTokenKeys;
  }): Promise<{ status: "refreshed"; tokens: CodexTokenKeys } | { status: "session_expired" }> {
    try {
      const tokens = await this.account.refresh(input.tokens);
      return { status: "refreshed", tokens };
    } catch (error) {
      if (error instanceof CodexAuthError && error.kind === "refresh_rejected") {
        return { status: "session_expired" };
      }
      throw error;
    }
  }
}

function pollIntervalOf(interval: unknown): number {
  if (typeof interval === "number") return interval;
  return typeof interval === "string" ? Number(interval) : 5;
}
