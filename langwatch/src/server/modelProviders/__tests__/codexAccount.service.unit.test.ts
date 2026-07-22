/**
 * The Codex device-code auth engine against a scripted issuer (spec:
 * specs/model-providers/codex-account-provider.feature). The fetch seam is
 * the network boundary; everything inside the service is real.
 */
import { describe, expect, it } from "vitest";
import type { CodexTokenKeys } from "../codexAccount.schema";
import {
  CodexAccountService,
  CodexAuthError,
  CodexGatewayRefreshService,
  decodeCodexClaims,
} from "../codexAccount.service";

/** A minimal unsigned JWT with the OpenAI auth claim, base64url-encoded. */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

const ID_TOKEN = fakeIdToken({
  email: "dev@example.com",
  "https://api.openai.com/auth": {
    chatgpt_account_id: "acct-123",
    chatgpt_plan_type: "pro",
  },
});

type Script = Record<
  string,
  (body: string) => { status: number; json: unknown }
>;

/** fetch stand-in routed by URL path, recording every request body. */
function scriptedFetch(script: Script) {
  const calls: { url: string; body: string }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, body });
    const path = new URL(url).pathname;
    const handler = script[path];
    if (!handler) throw new Error(`unscripted path: ${path}`);
    const result = handler(body);
    return new Response(JSON.stringify(result.json), {
      status: result.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("CodexAccountService", () => {
  describe("when starting a device sign-in", () => {
    it("returns the one-time code, poll handle and verification URL", async () => {
      const { impl, calls } = scriptedFetch({
        "/api/accounts/deviceauth/usercode": () => ({
          status: 200,
          json: {
            device_auth_id: "dev-1",
            user_code: "ABCD-1234",
            interval: 3,
          },
        }),
      });
      const service = new CodexAccountService(impl, "https://issuer.test");
      const device = await service.startDeviceSignIn();
      expect(device).toMatchObject({
        deviceAuthId: "dev-1",
        userCode: "ABCD-1234",
        intervalSeconds: 3,
      });
      expect(device.verificationUrl).toContain("/codex/device");
      expect(calls[0]!.body).toContain("client_id");
    });
  });

  describe("while the user has not approved yet", () => {
    it.each([403, 404])("reports HTTP %i as pending", async (status) => {
      const { impl } = scriptedFetch({
        "/api/accounts/deviceauth/token": () => ({
          status,
          json: { error: "authorization_pending" },
        }),
      });
      const service = new CodexAccountService(impl, "https://issuer.test");
      const result = await service.pollDeviceSignIn({
        deviceAuthId: "dev-1",
        userCode: "ABCD-1234",
      });
      expect(result).toEqual({ status: "pending" });
    });
  });

  describe("when the user approves", () => {
    it("exchanges the server-made PKCE pair and returns the token keys", async () => {
      const { impl, calls } = scriptedFetch({
        "/api/accounts/deviceauth/token": () => ({
          status: 200,
          json: { authorization_code: "code-1", code_verifier: "verifier-1" },
        }),
        "/oauth/token": () => ({
          status: 200,
          json: {
            access_token: "access-1",
            refresh_token: "refresh-1",
            id_token: ID_TOKEN,
          },
        }),
      });
      const service = new CodexAccountService(impl, "https://issuer.test");
      const result = await service.pollDeviceSignIn({
        deviceAuthId: "dev-1",
        userCode: "ABCD-1234",
      });
      expect(result.status).toBe("complete");
      const keys = (result as { keys: CodexTokenKeys }).keys;
      expect(keys.CODEX_ACCESS_TOKEN).toBe("access-1");
      expect(keys.CODEX_REFRESH_TOKEN).toBe("refresh-1");
      expect(keys.CODEX_ACCOUNT_ID).toBe("acct-123");
      expect(keys.CODEX_PLAN).toBe("pro");
      expect(keys.CODEX_EMAIL).toBe("dev@example.com");
      expect(Date.parse(keys.CODEX_TOKENS_SAVED_AT)).not.toBeNaN();
      // The exchange carried the PKCE verifier and the device redirect.
      const exchange = calls.find((c) => c.url.endsWith("/oauth/token"))!;
      expect(exchange.body).toContain("code_verifier=verifier-1");
      expect(exchange.body).toContain("grant_type=authorization_code");
    });
  });

  describe("when refreshing an expired access token", () => {
    const storedKeys: CodexTokenKeys = {
      CODEX_ACCESS_TOKEN: "old-access",
      CODEX_REFRESH_TOKEN: "refresh-1",
      CODEX_ID_TOKEN: ID_TOKEN,
      CODEX_ACCOUNT_ID: "acct-123",
      CODEX_PLAN: "pro",
      CODEX_EMAIL: "dev@example.com",
      CODEX_TOKENS_SAVED_AT: "2026-07-01T00:00:00.000Z",
    };

    it("returns a fresh token set, keeping the old refresh token if none is rotated in", async () => {
      const { impl } = scriptedFetch({
        "/oauth/token": (body) => {
          expect(body).toContain("grant_type=refresh_token");
          return { status: 200, json: { access_token: "new-access" } };
        },
      });
      const service = new CodexAccountService(impl, "https://issuer.test");
      const refreshed = await service.refresh(storedKeys);
      expect(refreshed.CODEX_ACCESS_TOKEN).toBe("new-access");
      expect(refreshed.CODEX_REFRESH_TOKEN).toBe("refresh-1");
      expect(refreshed.CODEX_ACCOUNT_ID).toBe("acct-123");
    });

    it("classifies a rejected refresh as a dead session", async () => {
      const { impl } = scriptedFetch({
        "/oauth/token": () => ({
          status: 400,
          json: { error: "invalid_grant" },
        }),
      });
      const service = new CodexAccountService(impl, "https://issuer.test");
      await expect(service.refresh(storedKeys)).rejects.toMatchObject({
        name: "CodexAuthError",
        kind: "refresh_rejected",
      });
    });

    it("keeps an issuer 5xx retryable instead of declaring the session dead", async () => {
      const { impl } = scriptedFetch({
        "/oauth/token": () => ({
          status: 503,
          json: { error: "temporarily_unavailable" },
        }),
      });
      const service = new CodexAccountService(impl, "https://issuer.test");
      await expect(service.refresh(storedKeys)).rejects.toMatchObject({
        name: "CodexAuthError",
        kind: "http",
      });
    });

    it("keeps a network failure retryable instead of declaring the session dead", async () => {
      const impl = (async () => {
        throw new TypeError("fetch failed: getaddrinfo ENOTFOUND");
      }) as unknown as typeof fetch;
      const service = new CodexAccountService(impl, "https://issuer.test");
      await expect(service.refresh(storedKeys)).rejects.toMatchObject({
        name: "CodexAuthError",
        kind: "http",
      });
    });
  });

  describe("decodeCodexClaims", () => {
    it("reads account id, plan and email from the OpenAI auth claim", () => {
      expect(decodeCodexClaims(ID_TOKEN)).toEqual({
        accountId: "acct-123",
        email: "dev@example.com",
        plan: "pro",
      });
    });

    it("degrades to empty fields on garbage input", () => {
      expect(decodeCodexClaims("not-a-jwt")).toEqual({
        accountId: "",
        email: "",
        plan: "",
      });
    });
  });

  describe("when the issuer misbehaves", () => {
    it("surfaces malformed responses as typed errors", async () => {
      const { impl } = scriptedFetch({
        "/api/accounts/deviceauth/usercode": () => ({
          status: 200,
          json: { nope: true },
        }),
      });
      const service = new CodexAccountService(impl, "https://issuer.test");
      await expect(service.startDeviceSignIn()).rejects.toBeInstanceOf(
        CodexAuthError,
      );
    });
  });
});

describe("CodexGatewayRefreshService", () => {
  const storedKeys: CodexTokenKeys = {
    CODEX_ACCESS_TOKEN: "old-access",
    CODEX_REFRESH_TOKEN: "refresh-1",
    CODEX_ID_TOKEN: ID_TOKEN,
    CODEX_ACCOUNT_ID: "acct-123",
    CODEX_PLAN: "pro",
    CODEX_EMAIL: "dev@example.com",
    // Long past the just-refreshed window, so the service really refreshes.
    CODEX_TOKENS_SAVED_AT: "2026-07-01T00:00:00.000Z",
  };

  function harness(tokenEndpoint: () => { status: number; json: unknown }) {
    const replaced: Record<string, unknown>[] = [];
    const events: {
      organizationId: string;
      kind: string;
      modelProviderId: string;
    }[] = [];
    const repository = {
      findByIdWithDecryptedKeys: async () => ({
        provider: "openai_codex",
        organizationId: "org-1",
        customKeys: storedKeys,
      }),
      replaceCustomKeys: async (args: {
        id: string;
        customKeys: Record<string, unknown>;
      }) => {
        replaced.push(args.customKeys);
      },
    };
    const changeEvents = {
      append: async (input: {
        organizationId: string;
        kind: "MODEL_PROVIDER_UPDATED";
        modelProviderId: string;
      }) => {
        events.push(input);
        return { revision: 1n };
      },
    };
    const { impl } = scriptedFetch({ "/oauth/token": tokenEndpoint });
    const engine = new CodexAccountService(impl, "https://issuer.test");
    const service = new CodexGatewayRefreshService(
      repository,
      changeEvents,
      engine,
    );
    return { service, replaced, events };
  }

  describe("when the refresh succeeds", () => {
    it("persists the rotation AND evicts the gateway's cached credential", async () => {
      // Without the change event the gateway keeps dispatching the stale
      // token from its in-memory bundle: every request 401s, refreshes
      // again, and the tokens rotate in a loop.
      const { service, replaced, events } = harness(() => ({
        status: 200,
        json: { access_token: "new-access" },
      }));

      const result = await service.refreshForGateway("row-1");

      expect(result).toMatchObject({
        status: "refreshed",
        accessToken: "new-access",
      });
      expect(replaced).toHaveLength(1);
      expect(events).toEqual([
        {
          organizationId: "org-1",
          kind: "MODEL_PROVIDER_UPDATED",
          modelProviderId: "row-1",
        },
      ]);
    });
  });

  describe("when the issuer rejects the grant", () => {
    it("reports a dead session and leaves the stored tokens untouched", async () => {
      const { service, replaced, events } = harness(() => ({
        status: 400,
        json: { error: "invalid_grant" },
      }));

      const result = await service.refreshForGateway("row-1");

      expect(result).toEqual({ status: "session_expired" });
      expect(replaced).toHaveLength(0);
      expect(events).toHaveLength(0);
    });
  });

  describe("when the issuer fails transiently", () => {
    it("propagates the retryable failure instead of declaring the session dead", async () => {
      const { service, replaced } = harness(() => ({
        status: 503,
        json: { error: "temporarily_unavailable" },
      }));

      await expect(service.refreshForGateway("row-1")).rejects.toMatchObject({
        name: "CodexAuthError",
        kind: "http",
      });
      expect(replaced).toHaveLength(0);
    });
  });
});
