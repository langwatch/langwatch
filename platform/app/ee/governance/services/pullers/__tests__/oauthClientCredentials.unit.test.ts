/**
 * Unit coverage for the per-run OAuth2 client-credentials token provider.
 *
 * The provider is deliberately per-run rather than a module-level cache. The
 * tests below pin the two properties that actually matter for correctness —
 * one token per run, and never a token that expires mid-flight — plus the one
 * that matters for safety: neither the token nor the client secret may reach
 * a log line or an error message.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueuedResponse {
  status: number;
  body?: unknown;
}

// Deliberately not JWT-shaped. The tests only ever compare these by value, and
// a base64-looking literal here reads as a real leaked key to the repo's secret
// scanner — a fixture is not worth a red `secrets` job on every push.
const SECRET = "not-a-real-client-secret";
const TOKEN = "not-a-real-access-token";

const CREDENTIALS = {
  tenantId: "acme-tenant-guid",
  clientId: "acme-app-guid",
  clientSecret: SECRET,
};
const SCOPE = "https://manage.office.test/.default";

let capturedCalls: Array<{ url: string; body?: string }> = [];
let responseQueue: QueuedResponse[] = [];

beforeEach(() => {
  capturedCalls = [];
  responseQueue = [];
  vi.doMock("~/utils/ssrfProtection", () => ({
    ssrfSafeFetch: async (url: string, init?: { body?: string }) => {
      capturedCalls.push({ url, body: init?.body });
      const next = responseQueue.shift();
      if (!next) throw new Error("test bug: no queued response");
      return new Response(JSON.stringify(next.body ?? {}), {
        status: next.status,
        headers: { "content-type": "application/json" },
      });
    },
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function loadProvider() {
  return await import("../shared/oauthClientCredentials");
}

const tokenEndpoint = (tenantId: string) =>
  `https://login.microsoftonline.test/${tenantId}/oauth2/v2.0/token`;

describe("createTokenProvider", () => {
  /** @scenario "Token is fetched once per run and reused for that run's requests" */
  it("calls the token endpoint once and hands the same token to every caller", async () => {
    const { createTokenProvider } = await loadProvider();
    responseQueue = [
      { status: 200, body: { access_token: TOKEN, expires_in: 3600 } },
    ];

    const nowMs = 1_000_000;
    const provider = createTokenProvider({
      credentials: CREDENTIALS,
      scope: SCOPE,
      now: () => nowMs,
      tokenEndpoint,
    });

    const first = await provider.getToken();
    const second = await provider.getToken();
    const third = await provider.getToken();

    expect(first).toBe(TOKEN);
    expect(second).toBe(TOKEN);
    expect(third).toBe(TOKEN);
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0]?.url).toContain(CREDENTIALS.tenantId);
  });

  it("does not issue two token requests when callers race inside one run", async () => {
    const { createTokenProvider } = await loadProvider();
    responseQueue = [
      { status: 200, body: { access_token: TOKEN, expires_in: 3600 } },
    ];

    const provider = createTokenProvider({
      credentials: CREDENTIALS,
      scope: SCOPE,
      now: () => 1_000_000,
      tokenEndpoint,
    });

    const [a, b, c] = await Promise.all([
      provider.getToken(),
      provider.getToken(),
      provider.getToken(),
    ]);

    expect([a, b, c]).toEqual([TOKEN, TOKEN, TOKEN]);
    expect(capturedCalls).toHaveLength(1);
  });

  /** @scenario "A token expiring mid-run is refreshed before it is used" */
  it("refreshes once the refresh margin is crossed, never returning an expired token", async () => {
    const { createTokenProvider, REFRESH_MARGIN_MS } = await loadProvider();
    const refreshed = `${TOKEN}-refreshed`;
    responseQueue = [
      // A short-lived token: 90s, so the margin bites well before expiry.
      { status: 200, body: { access_token: TOKEN, expires_in: 90 } },
      { status: 200, body: { access_token: refreshed, expires_in: 3600 } },
    ];

    let clock = 1_000_000;
    const provider = createTokenProvider({
      credentials: CREDENTIALS,
      scope: SCOPE,
      now: () => clock,
      tokenEndpoint,
    });

    expect(await provider.getToken()).toBe(TOKEN);
    expect(capturedCalls).toHaveLength(1);

    // Still comfortably inside the validity window: no refresh.
    clock += 10_000;
    expect(await provider.getToken()).toBe(TOKEN);
    expect(capturedCalls).toHaveLength(1);

    // Now inside the refresh margin, but the old token has NOT expired yet.
    // It must still be replaced — that is the point of the margin.
    clock = 1_000_000 + 90_000 - REFRESH_MARGIN_MS + 1;
    expect(await provider.getToken()).toBe(refreshed);
    expect(capturedCalls).toHaveLength(2);
  });

  it("treats a missing expires_in as a short lifetime rather than a long one", async () => {
    const { createTokenProvider } = await loadProvider();
    responseQueue = [
      { status: 200, body: { access_token: TOKEN } },
      { status: 200, body: { access_token: `${TOKEN}-2`, expires_in: 3600 } },
    ];

    let clock = 1_000_000;
    const provider = createTokenProvider({
      credentials: CREDENTIALS,
      scope: SCOPE,
      now: () => clock,
      tokenEndpoint,
    });

    expect(await provider.getToken()).toBe(TOKEN);
    // Past the assumed 300s floor — a provider that assumed "long-lived"
    // would still be handing back the first token here.
    clock += 301_000;
    expect(await provider.getToken()).toBe(`${TOKEN}-2`);
  });

  /** @scenario "Token value never reaches logs or error messages" */
  it("keeps the token and the client secret out of every error it raises", async () => {
    const { createTokenProvider, TokenAcquisitionError } = await loadProvider();
    const { fetchWithRetry } = await import("../shared/httpRetry");

    // 1. A token endpoint that answers with no access_token.
    responseQueue = [{ status: 200, body: { error: "invalid_client" } }];
    const provider = createTokenProvider({
      credentials: CREDENTIALS,
      scope: SCOPE,
      now: () => 1_000_000,
      tokenEndpoint,
    });

    let raised: unknown;
    try {
      await provider.getToken();
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(TokenAcquisitionError);
    const tokenError = String(raised);
    expect(tokenError).not.toContain(SECRET);
    expect(tokenError).not.toContain(TOKEN);
    // The secret went out in the request body; it must not come back in the
    // error that describes that request.
    expect(capturedCalls[0]?.body).toContain(SECRET);

    // 2. A downstream call that fails while carrying the token.
    capturedCalls = [];
    responseQueue = [
      { status: 200, body: { access_token: TOKEN, expires_in: 3600 } },
    ];
    const goodProvider = createTokenProvider({
      credentials: CREDENTIALS,
      scope: SCOPE,
      now: () => 1_000_000,
      tokenEndpoint,
    });
    const bearer = await goodProvider.getToken();

    responseQueue = [{ status: 401 }];
    let downstream: unknown;
    try {
      await fetchWithRetry({
        url: "https://manage.office.test/api/v1.0/t/activity/feed/content",
        headers: { authorization: `Bearer ${bearer}` },
        sleep: async () => void 0,
      });
    } catch (error) {
      downstream = error;
    }
    const downstreamError = String(downstream);
    expect(downstreamError).toMatch(/HTTP 401/);
    expect(downstreamError).not.toContain(TOKEN);
    expect(downstreamError).not.toContain(SECRET);
  });
});

describe("given the token endpoint refuses the credentials", () => {
  describe("when the refusal carries a client status", () => {
    /** @scenario "A token-endpoint refusal is raised as TokenAcquisitionError" */
    it("translates it, and keeps the refusal body out of the error", async () => {
      // A real invalid_client body: Azure quotes the request back at us, so
      // anything that forwards this verbatim is a secret-shaped log entry.
      responseQueue = [
        {
          status: 401,
          body: {
            error: "invalid_client",
            error_description: `AADSTS7000215: Invalid client secret ${SECRET}`,
          },
        },
      ];

      const { createTokenProvider, TokenAcquisitionError } =
        await loadProvider();
      const provider = createTokenProvider({
        credentials: CREDENTIALS,
        scope: SCOPE,
        deadlineAtMs: Date.now() + 10_000,
        tokenEndpoint,
      });

      const failure = await provider
        .getToken()
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(TokenAcquisitionError);
      expect((failure as Error).message).toContain("401");
      expect((failure as Error).message).not.toContain(SECRET);
      expect((failure as Error).message).not.toContain("AADSTS7000215");
    });
  });

  describe("when the failure is not the endpoint refusing us", () => {
    /** @scenario "A token-endpoint refusal is raised as TokenAcquisitionError" */
    it("leaves an exhausted 5xx as it was, so the caller can still tell them apart", async () => {
      responseQueue = Array.from({ length: 8 }, () => ({
        status: 503,
        body: { error: "temporarily_unavailable" },
      }));

      const { createTokenProvider, TokenAcquisitionError } =
        await loadProvider();
      const provider = createTokenProvider({
        credentials: CREDENTIALS,
        scope: SCOPE,
        deadlineAtMs: Date.now() + 10_000,
        tokenEndpoint,
      });

      const failure = await provider
        .getToken()
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(TokenAcquisitionError);
    });
  });
});
