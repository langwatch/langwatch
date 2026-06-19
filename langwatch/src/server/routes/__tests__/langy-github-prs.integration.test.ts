/**
 * @vitest-environment node
 *
 * Spec: specs/assistant/langy-github-prs.feature — "Langy opens GitHub PRs as
 * the requesting user". Issue: #4747.
 *
 * These are integration tests: each boundary is mocked at its module/fetch
 * seam (Prisma, GitHub HTTP, Redis, the agent /chat call) so the suite needs
 * no live DB/Redis — but the REAL code paths run. The Hono OAuth callback is
 * exercised end-to-end through `app.request`; the credential store, token
 * mint, PR-link extractor, progress parser, sentinel stripper, disconnect
 * router and PR-cap counter all run for real against their mocked boundary.
 *
 * Patterns reused verbatim from sibling tests:
 *   - github-langy-callback.unit.test.ts  (TEST_SIGNING_KEY, makeState,
 *     mockGithubFetch, callCallback, the Prisma/auth/encryption mocks)
 *   - langy-connect-card.test.ts          (postChat, agentStreamResponse,
 *     drain, the chat-route service-boundary mocks)
 *
 * BOUNDARY NOTES (read by the reviewer):
 *   - Scenarios 4 & 7 describe the worker process (services/langy-agent/
 *     server.js) wiping its home dir and the idle reaper deleting the clone.
 *     server.js is plain Node, not a module this TS suite can import, so we
 *     assert the contract the *control plane* owns: the TS layer never
 *     persists a GitHub access token (the only thing kept at rest is the
 *     ENCRYPTED refresh token), and a revoked/expired credential stops
 *     minting. The worker-side filesystem wipe is covered where the code
 *     lives (the agent repo), not duplicated here.
 *   - Scenario 6 (installation scoping) is enforced inside the agent's
 *     github.md skill, which only opens PRs on repos the App is installed on.
 *     The nearest TS-observable behavior is the PR-link extractor: a reply
 *     that opened NO PR (no `opened` progress sentinel) yields no PR link, so
 *     the control plane neither cards a PR nor bumps the cap. We assert that
 *     observable boundary plus the explanation surviving into the reply.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared env — both the OAuth callback and the token mint read these at import
// time. Set before any import that pulls them in.
// ---------------------------------------------------------------------------
const TEST_SIGNING_KEY = "x".repeat(64);
process.env.CREDENTIALS_SECRET = TEST_SIGNING_KEY;
process.env.GITHUB_LANGY_CLIENT_ID = "test-client-id";
process.env.GITHUB_LANGY_CLIENT_SECRET = "test-client-secret";
process.env.OPENCODE_AGENT_URL = "http://agent.test";
process.env.LANGY_INTERNAL_SECRET = "internal-secret";

import {
  extractGithubPrLinks,
  extractOpenedPrLinks,
} from "../../services/langy/githubPrLinks";
import { parseGithubProgressEvents } from "../../services/langy/githubProgressEvents";
import { stripLangySentinels } from "../../services/langy/langySentinels";

// ===========================================================================
// SCENARIOS 1 & 2 — connecting GitHub (OAuth callback round-trip).
//
// The callback is the public REST endpoint; the connect/popup flow finishes
// here. We mock the GitHub token exchange + /user at the fetch boundary and
// Prisma at its module seam, exactly like github-langy-callback.unit.test.ts,
// and drive the Hono app end-to-end through app.request.
// ===========================================================================

const getServerAuthSession = vi.fn();
const upsert = vi.fn();
const auditLog = vi.fn();
const encrypt = vi.fn((v: string) => `enc(${v})`);
const membershipFindUnique = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));
vi.mock("~/server/db", () => ({
  prisma: {
    userGitHubCredential: {
      upsert: (...args: unknown[]) => upsert(...args),
    },
    organizationUser: {
      findUnique: (...args: unknown[]) => membershipFindUnique(...args),
    },
  },
}));
vi.mock("~/server/auditLog", () => ({
  auditLog: (...args: unknown[]) => auditLog(...args),
}));
vi.mock("~/utils/encryption", () => ({
  encrypt: (v: string) => encrypt(v),
  // decrypt is exercised by the token-mint scenarios; mirror encrypt so a
  // round-trip is lossless inside the suite.
  decrypt: (v: string) =>
    typeof v === "string" && v.startsWith("enc(") ? v.slice(4, -1) : v,
}));

async function callCallback(url: string) {
  const { app } = await import("../github-langy");
  return app.request(url, { method: "GET" });
}

async function makeState(
  payload: Partial<{
    userId: string;
    organizationId: string;
    mode: "popup" | "redirect";
    returnTo: string;
    issuedAt: number;
    nonceRegistered: boolean;
  }> = {},
) {
  const { signGithubOauthState } = await import(
    "~/server/services/langy/githubOauthState"
  );
  return signGithubOauthState(
    {
      userId: payload.userId ?? "u1",
      organizationId: payload.organizationId ?? "org1",
      mode: payload.mode ?? "popup",
      returnTo: payload.returnTo ?? "/settings/integrations#github",
      issuedAt: payload.issuedAt ?? Date.now(),
      nonce: "n",
      // Redis isn't wired here, so /connect couldn't have registered the
      // nonce — the callback must skip consumption.
      nonceRegistered: payload.nonceRegistered ?? false,
    },
    TEST_SIGNING_KEY,
  );
}

function mockGithubExchangeFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("github.com/login/oauth/access_token")) {
      return new Response(
        JSON.stringify({
          access_token: "at-live-123",
          refresh_token: "rt-secret-abc",
          expires_in: 28800,
          scope: "repo",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("api.github.com/user")) {
      return new Response(JSON.stringify({ id: 999, login: "octocat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Feature: Langy opens GitHub PRs as the requesting user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    getServerAuthSession.mockResolvedValue({ user: { id: "u1" } });
    membershipFindUnique.mockResolvedValue({
      userId: "u1",
      organizationId: "org1",
    });
  });

  describe("given I am signed in and the App is installed on acme/service-x", () => {
    describe("when I connect GitHub via settings (redirect mode)", () => {
      /** @scenario "User connects GitHub via settings" */
      it("persists only an encrypted refresh token, audits the connect, and 302s back to settings", async () => {
        const state = await makeState({
          mode: "redirect",
          returnTo: "/settings/integrations#github",
        });
        const fetchMock = mockGithubExchangeFetch();

        const res = await callCallback(
          `http://localhost/api/github-langy/callback?code=c&state=${encodeURIComponent(state)}`,
        );

        // Settings shows my GitHub login as connected — the redirect lands
        // back on the integrations page (the page reads the persisted row).
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(
          "/settings/integrations#github",
        );

        // An encrypted refresh token is stored for my user and organization.
        expect(upsert).toHaveBeenCalledOnce();
        const call = upsert.mock.calls[0]?.[0] as {
          where: {
            userId_organizationId: { userId: string; organizationId: string };
          };
          create: { encryptedRefreshToken: string; githubLogin: string };
          update: { encryptedRefreshToken: string; githubLogin: string };
        };
        expect(call.where.userId_organizationId).toEqual({
          userId: "u1",
          organizationId: "org1",
        });
        expect(call.create.githubLogin).toBe("octocat");
        // The stored value is the ENCRYPTED refresh token, never plaintext.
        expect(encrypt).toHaveBeenCalledWith("rt-secret-abc");
        expect(call.create.encryptedRefreshToken).toBe("enc(rt-secret-abc)");

        // No GitHub ACCESS token is persisted anywhere — the only thing the
        // upsert row carries is the (encrypted) refresh token. The raw access
        // token never reached the persistence layer.
        const persistedBlob = JSON.stringify(upsert.mock.calls[0]?.[0]);
        expect(persistedBlob).not.toContain("at-live-123");
        // The refresh token reaches Prisma only as ciphertext (encrypt() ran);
        // the route never hands Prisma the plaintext refresh token directly.
        expect(call.create.encryptedRefreshToken).not.toBe("rt-secret-abc");
        expect(call.update.encryptedRefreshToken).toBe("enc(rt-secret-abc)");

        // The exchange genuinely ran (code → token → /user).
        expect(fetchMock).toHaveBeenCalled();
        expect(auditLog).toHaveBeenCalledWith(
          expect.objectContaining({ action: "langy.github.connect" }),
        );
      });
    });

    describe("when I connect GitHub via the in-chat card (popup mode)", () => {
      /** @scenario "User connects GitHub via the in-chat card" */
      it("returns a postMessage shim naming my login so the popup closes and the chip can appear", async () => {
        const state = await makeState({ mode: "popup" });
        mockGithubExchangeFetch();

        const res = await callCallback(
          `http://localhost/api/github-langy/callback?code=c&state=${encodeURIComponent(state)}`,
        );

        expect(res.status).toBe(200);
        const html = await res.text();

        // The popup closes and posts the connected login back to the opener
        // (which is how the chat continues without losing my message and the
        // "Acting as @login" chip appears in the sidebar footer).
        expect(html).toContain("langy-github-connected");
        expect(html).toContain("@octocat");
        expect(html).toContain("window.close()");
        expect(html).toContain("postMessage");

        // Same persistence contract as the settings path: encrypted refresh
        // token only, no access token at rest.
        expect(encrypt).toHaveBeenCalledWith("rt-secret-abc");
        const persistedBlob = JSON.stringify(upsert.mock.calls[0]?.[0]);
        expect(persistedBlob).not.toContain("at-live-123");
      });
    });
  });
});

// ===========================================================================
// SCENARIOS 3, 6, 8, 9 — chat-route behavior.
//
// These exercise the /api/langy/chat Hono route end-to-end with its service
// boundaries mocked (mirrors langy-connect-card.test.ts). The agent /chat
// call is mocked at the fetch boundary; the stream is drained so the real
// strip helper + PR-link extractor + progress parser run.
// ===========================================================================

// The chat route shares the `~/server/auth` + `~/server/auditLog` module
// mocks declared above (getServerAuthSession / auditLog); re-point their
// resolved values per test rather than re-declaring spies.
const hasProjectPermission = vi.fn();
const getVercelAIModel = vi.fn();
const checkLangyMessageRateLimit = vi.fn();
const getLangyGithubPrUsage = vi.fn();
const recordLangyGithubPr = vi.fn();
const getOrProvision = vi.fn();
const getModelsAllowed = vi.fn();
const ensureConversation = vi.fn();
const touchConversation = vi.fn();
const appendMessage = vi.fn();

vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    hasProjectPermission: (...args: unknown[]) => hasProjectPermission(...args),
  };
});
vi.mock("~/server/modelProviders/utils", () => ({
  getVercelAIModel: (...args: unknown[]) => getVercelAIModel(...args),
}));
vi.mock("~/server/middleware/rate-limit-langy", () => ({
  checkLangyMessageRateLimit: (...args: unknown[]) =>
    checkLangyMessageRateLimit(...args),
}));
vi.mock("~/server/middleware/rate-limit-langy-github-prs", () => ({
  LANGY_GITHUB_PRS_PER_DAY: 20,
  getLangyGithubPrUsage: (...args: unknown[]) => getLangyGithubPrUsage(...args),
  recordLangyGithubPr: (...args: unknown[]) => recordLangyGithubPr(...args),
}));
vi.mock("~/server/app-layer/clients/tokenizer/tiktoken.client", () => ({
  TiktokenClient: class {
    async countTokens() {
      return 1;
    }
  },
}));
vi.mock("~/server/services/langy/LangyCredentialService", () => ({
  LangyCredentialResolutionError: class extends Error {},
  LangyCredentialService: {
    create: () => ({
      getOrProvision: (...args: unknown[]) => getOrProvision(...args),
      getModelsAllowed: (...args: unknown[]) => getModelsAllowed(...args),
    }),
  },
}));
vi.mock("~/server/services/langy/LangyConversationService", () => ({
  LangyConversationNotOwnedError: class extends Error {},
  LangyConversationService: {
    create: () => ({
      ensureConversation: (...args: unknown[]) => ensureConversation(...args),
      touch: (...args: unknown[]) => touchConversation(...args),
    }),
  },
}));
vi.mock("~/server/services/langy/LangyMessageService", async () => {
  const actual = await vi.importActual<
    typeof import("~/server/services/langy/LangyMessageService")
  >("~/server/services/langy/LangyMessageService");
  return {
    ...actual,
    LangyMessageService: {
      create: () => ({
        append: (...args: unknown[]) => appendMessage(...args),
      }),
    },
  };
});
// `~/server/auth` is already mocked above (getServerAuthSession). The chat
// route reads the SAME mock; re-point its resolved value per test below.

/** Build an agent /chat NDJSON stream carrying a single text delta. */
function agentStreamResponse(replyText: string): Response {
  const line =
    JSON.stringify({
      type: "message.part.delta",
      properties: { field: "text", delta: replyText },
    }) + "\n";
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(line));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

async function postChat(prompt: string) {
  const { app } = await import("../langy");
  return app.request("http://localhost/api/langy/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "p1",
      conversationId: null,
      messages: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    }),
  });
}

async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("Feature: Langy chat opens PRs as the requesting user", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function stubAgentReply(replyText: string) {
    fetchMock = vi.fn(async () => agentStreamResponse(replyText));
    vi.stubGlobal("fetch", fetchMock);
  }

  function forwardedAgentBody(): {
    credentials: Record<string, unknown>;
    system?: string;
  } {
    const call = fetchMock.mock.calls.find(
      ([url]) => url === "http://agent.test/chat",
    ) as [string, { body: string }] | undefined;
    expect(call).toBeDefined();
    return JSON.parse(call![1].body);
  }

  function persistedAssistantText(): string {
    const assistant = appendMessage.mock.calls
      .map((c) => c[0] as { role: string; parts: { text?: string }[] })
      .find((a) => a.role === "assistant");
    expect(assistant).toBeDefined();
    return assistant!.parts.map((p) => p.text ?? "").join("");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    getServerAuthSession.mockResolvedValue({
      user: { id: "u-connected", email: "user@acme.com" },
    });
    hasProjectPermission.mockResolvedValue(true);
    getVercelAIModel.mockResolvedValue({});
    checkLangyMessageRateLimit.mockResolvedValue({ allowed: true });
    getModelsAllowed.mockResolvedValue(null);
    getLangyGithubPrUsage.mockResolvedValue({
      allowed: true,
      remaining: 20,
      resetAt: Date.now() + 86_400_000,
    });
    recordLangyGithubPr.mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: Date.now() + 86_400_000,
    });
    ensureConversation.mockResolvedValue({ id: "conv-1" });
    appendMessage.mockResolvedValue({ id: "msg-1" });
    touchConversation.mockResolvedValue(undefined);

    // Connected user: credentials carry a github token + login (this is what
    // the resolver returns once getGithubTokenForUser succeeds).
    getOrProvision.mockResolvedValue({
      langwatchApiKey: "sk-lw-test",
      llmVirtualKey: "vk-test",
      langwatchEndpoint: "http://lw.test",
      gatewayBaseUrl: "http://gw.test/v1",
      organizationId: "org-1",
      githubToken: "gho_live_token",
      githubLogin: "octocat",
    });
  });

  describe("given I have connected my GitHub account", () => {
    describe("when I ask Langy to fix a file and open a PR on acme/service-x", () => {
      /** @scenario "Connected user asks Langy to open a PR" */
      it("forwards my github token, records the opened PR against the cap, and surfaces the PR link as a card", async () => {
        // Worker reply: progress sentinels through to `opened`, ending with
        // the real PR URL. extractOpenedPrLinks runs for real on this text.
        const opened = "acme/service-x#42";
        stubAgentReply(
          `[langy:progress:cloning:acme/service-x]\n` +
            `[langy:progress:branched:fix/typo]\n` +
            `[langy:progress:committed:abc123]\n` +
            `[langy:progress:pushed:fix/typo]\n` +
            `[langy:progress:opened:${opened}]\n\n` +
            `Done — opened https://github.com/acme/service-x/pull/42 for you.`,
        );

        const res = await postChat(
          "Fix the typo in README and open a PR on acme/service-x",
        );
        expect(res.status).toBe(200);

        // The credentials forwarded to the agent carry MY github token + login
        // so the PR author on GitHub is my GitHub user.
        const forwarded = forwardedAgentBody();
        expect(forwarded.credentials.githubToken).toBe("gho_live_token");
        expect(forwarded.credentials.githubLogin).toBe("octocat");

        // The reply contains a real opened-PR link, so the cap counter is
        // bumped exactly once for the PR that was actually opened.
        const streamed = await drain(res);
        expect(recordLangyGithubPr).toHaveBeenCalledTimes(1);
        expect(recordLangyGithubPr).toHaveBeenCalledWith(
          expect.objectContaining({ userId: "u-connected" }),
        );

        // The persisted reply renders the PR as a card: the PR URL survives
        // (so the card extractor finds it) while progress sentinels are
        // stripped from history.
        const persisted = persistedAssistantText();
        expect(persisted).toContain(
          "https://github.com/acme/service-x/pull/42",
        );
        expect(persisted).not.toContain("[langy:progress:");
        const cardLinks = extractGithubPrLinks(persisted);
        expect(cardLinks).toEqual([
          {
            owner: "acme",
            repo: "service-x",
            number: 42,
            url: "https://github.com/acme/service-x/pull/42",
          },
        ]);

        // The live steps stream carried the progress markers to the client.
        expect(streamed).toContain("[langy:progress:");
      });
    });

    describe("when the worker is asked for a repo the App is NOT installed on", () => {
      /*
       * Installation scoping is enforced inside the agent's github.md skill —
       * it only operates on repos the App can reach. The TS-observable
       * boundary: a turn that opened NO PR (no `opened` sentinel, no PR URL)
       * produces no PR link, so the control plane neither records a PR against
       * the cap nor renders a PR card, and the explanation reaches the user.
       */
      /** @scenario "Installation scoping bounds reachable repositories" */
      it("opens no PR, bumps no cap, and surfaces the not-available explanation", async () => {
        stubAgentReply(
          "I can't open a PR on acme/other-repo — the LangWatch GitHub App " +
            "isn't installed on that repository, so it isn't available to me.",
        );

        const res = await postChat("Open a PR on acme/other-repo");
        expect(res.status).toBe(200);

        const streamed = await drain(res);

        // No PR was opened: no link, no `opened` progress event.
        const persisted = persistedAssistantText();
        expect(extractOpenedPrLinks(persisted)).toEqual([]);
        expect(persisted).not.toMatch(/github\.com\/[^\s]+\/pull\/\d+/);
        // The cap is untouched (the route only records when an opened-PR link
        // is present).
        expect(recordLangyGithubPr).not.toHaveBeenCalled();

        // Langy explains the repo is not available to the LangWatch app.
        expect(streamed.toLowerCase()).toContain("isn't installed");
        expect(streamed.toLowerCase()).toContain("isn't available");
      });
    });

    describe("when I ask Langy to open a PR on acme/service-x", () => {
      /** @scenario "Live steps card reflects the worker's progress" */
      it("streams ordered progress stages, marks opened with the PR url, and strips raw markers from history", async () => {
        const reply =
          `[langy:progress:cloning:acme/service-x]\n` +
          `[langy:progress:branched:fix/x]\n` +
          `[langy:progress:committed:deadbeef]\n` +
          `[langy:progress:pushed:fix/x]\n` +
          `[langy:progress:opened:acme/service-x#7]\n\n` +
          `Opened https://github.com/acme/service-x/pull/7`;
        stubAgentReply(reply);

        const res = await postChat("Open a PR on acme/service-x");
        const streamed = await drain(res);

        // The live stream carries the markers so the steps card can render
        // cloning → branched → committed → pushed → opened in order.
        const { events } = parseGithubProgressEvents(streamed);
        const stages = events.map((e) => e.stage);
        expect(stages).toEqual([
          "cloning",
          "branched",
          "committed",
          "pushed",
          "opened",
        ]);
        // The opened step carries the PR identity (so the card flips to
        // "opened" when the PR URL arrives).
        const openedEvent = events.find((e) => e.stage === "opened");
        expect(openedEvent?.detail).toBe("acme/service-x#7");

        // No raw `[langy:progress:` markers survive into my chat history.
        const persisted = persistedAssistantText();
        expect(persisted).not.toContain("[langy:progress:");
        // Sanity: the strip helper this route uses leaves the prose + PR URL.
        expect(stripLangySentinels(reply)).toContain(
          "https://github.com/acme/service-x/pull/7",
        );
      });
    });

    describe("given I have already opened 20 PRs via Langy today", () => {
      describe("when I ask Langy to open another PR", () => {
        /** @scenario "Per-user daily PR cap stops runaway loops" */
        it("injects a cap-reached instruction into the agent system prompt and opens no new PR", async () => {
          // The pre-gate check reports the cap is reached.
          getLangyGithubPrUsage.mockResolvedValue({
            allowed: false,
            remaining: 0,
            resetAt: Date.parse("2030-01-02T00:00:00.000Z"),
          });
          // Even if the worker tried, it returns no PR this turn.
          stubAgentReply(
            "You've reached your daily limit of GitHub pull requests via " +
              "Langy. It resets later today.",
          );

          const res = await postChat("Open another PR on acme/service-x");
          expect(res.status).toBe(200);

          // The route forwards a system prompt telling the agent the cap is
          // reached and to refuse — this is how "Langy reports the daily cap
          // is reached".
          const forwarded = forwardedAgentBody();
          expect(forwarded.system).toContain("USER PR CAP REACHED");
          expect(forwarded.system).toContain("daily cap");
          expect(forwarded.system).toContain("20");

          await drain(res);
          // No PR is created until the cap resets: no opened-PR link in the
          // reply, so the counter is never bumped.
          expect(recordLangyGithubPr).not.toHaveBeenCalled();
        });
      });
    });
  });
});

// ===========================================================================
// SCENARIO 5 — revoking the connection (disconnect tRPC router).
//
// We run the real disconnect resolver against a mocked Prisma + Redis +
// GitHub-fetch boundary so the real revoke→delete→cache-clear sequence runs.
// ===========================================================================

describe("Feature: revoking the Langy GitHub connection", () => {
  // The token-mint + connection services read `~/server/redis`. Drive it
  // through a per-test global handle like rate-limit-langy-github-prs.unit.test.
  const redisGet = vi.fn();
  const redisDel = vi.fn();
  const redisSet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = null;
  });

  describe("given I have connected my GitHub account", () => {
    describe("when I disconnect GitHub in settings", () => {
      /** @scenario "Revoking the connection cuts off new sessions immediately" */
      it("deletes my stored credential and clears the cached token so the next session cannot mint", async () => {
        // Real connection-store delete + token-cache clear; mock Prisma + Redis.
        const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
        const findUnique = vi
          .fn()
          // membership check
          .mockResolvedValueOnce({ userId: "u1", organizationId: "org1" })
          // getGithubTokenForUser row read (for the GitHub-side revoke mint)
          .mockResolvedValue({
            encryptedRefreshToken: "enc(rt-secret-abc)",
            githubLogin: "octocat",
          });

        const prisma = {
          organizationUser: { findUnique },
          userGitHubCredential: { findUnique, deleteMany, update: vi.fn() },
        };

        // Redis: serve a cached access token so the revoke mint short-circuits
        // (no GitHub refresh call), then assert disconnect deletes that cache.
        const store = new Map<string, string>([
          ["langy:gh:at:u1:org1", "at-cached"],
        ]);
        redisGet.mockImplementation(async (k: string) => store.get(k) ?? null);
        redisDel.mockImplementation(async (k: string) => {
          const had = store.delete(k);
          return had ? 1 : 0;
        });
        redisSet.mockResolvedValue("OK");
        (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = {
          get: redisGet,
          del: redisDel,
          set: redisSet,
        };

        // GitHub grant-revoke DELETE — mock the fetch boundary so the real
        // revokeAtGitHub body runs without a network call.
        const fetchMock = vi.fn(
          async () => new Response("{}", { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const { langyGithubRouter } = await import(
          "~/server/api/routers/langyGithub"
        );
        const caller = langyGithubRouter.createCaller({
          prisma: prisma as never,
          session: { user: { id: "u1" } },
          // The router pulls auditLog from the module mock above; provide a
          // minimal ctx that satisfies the procedure's middleware shape.
          publiclyShared: false,
        } as never);

        const result = await caller.disconnect({ organizationId: "org1" });

        // My stored GitHub credential is deleted.
        expect(deleteMany).toHaveBeenCalledWith({
          where: { userId: "u1", organizationId: "org1" },
        });
        expect(result).toEqual({ ok: true, deleted: 1 });

        // The cached access token is cleared, so my next Langy session cannot
        // mint a GitHub token from a now-revoked grant.
        expect(redisDel).toHaveBeenCalledWith("langy:gh:at:u1:org1");
        expect(store.has("langy:gh:at:u1:org1")).toBe(false);

        // The GitHub grant was revoked (best-effort DELETE fired).
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/grant"),
          expect.objectContaining({ method: "DELETE" }),
        );

        // After delete, the mint path returns null (no row) — the next session
        // genuinely cannot mint.
        findUnique.mockResolvedValue(null);
        const { getGithubTokenForUser } = await import(
          "~/server/services/langy/langyGithubToken"
        );
        // Cache was cleared, so the mint falls through to the (now-missing)
        // row read and returns null.
        store.clear();
        const minted = await getGithubTokenForUser({
          prisma: prisma as never,
          userId: "u1",
          organizationId: "org1",
        });
        expect(minted).toBeNull();
      });
    });
  });
});

// Redis module seam shared by the token-mint + revoke scenarios.
vi.mock("~/server/redis", () => ({
  get connection() {
    return (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ ?? null;
  },
}));

// ===========================================================================
// SCENARIOS 4 & 7 — token never persists / lives only until the reaper.
//
// The worker-side filesystem wipe (services/langy-agent/server.js) is plain
// Node and not importable here; it is covered where it lives. The CONTRACT
// the TS control plane owns and that backs both scenarios:
//   - the ONLY thing kept at rest is the ENCRYPTED refresh token; the access
//     token the worker uses is minted on demand and cached in Redis with a
//     sub-TTL — it never touches Prisma (no column, no row).
//   - "a live worker may keep the token until the reaper runs" maps, on the
//     control-plane side, to the access-token CACHE TTL: a minted token is
//     served from cache (bounded TTL) and disconnect clears it — the TS layer
//     cannot reach into a running worker's env, exactly as the spec states.
// ===========================================================================

describe("Feature: Langy GitHub tokens never persist at rest", () => {
  const redisGet = vi.fn();
  const redisSet = vi.fn();
  const redisDel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    (globalThis as { __TEST_REDIS__?: unknown }).__TEST_REDIS__ = {
      get: redisGet,
      set: redisSet,
      del: redisDel,
    };
    redisSet.mockResolvedValue("OK");
    redisDel.mockResolvedValue(1);
  });

  describe("given I have connected my GitHub account", () => {
    describe("when Langy mints a token for a PR-opening task", () => {
      /*
       * The mint persists ONLY the rotated ENCRYPTED refresh token to Prisma;
       * the access token the worker carries is cached in Redis with a sub-TTL
       * and never written to the DB. This is the at-rest half of "tokens
       * never persist in the worker or repo clone" — the worker-home/clone
       * wipe lives in the agent repo.
       */
      /** @scenario "Tokens never persist in the worker or repo clone" */
      it("caches the access token in redis (sub-TTL) and persists only the encrypted refresh token", async () => {
        // Cold cache → the mint must refresh through GitHub.
        redisGet.mockResolvedValue(null);
        // Lock acquire uses SET NX EX (returns "OK" so we own the lock) and
        // the cache write uses SET EX — both resolve "OK".
        redisSet.mockResolvedValue("OK");

        const update = vi.fn().mockResolvedValue({});
        const findUnique = vi.fn().mockResolvedValue({
          encryptedRefreshToken: "enc(rt-old)",
          githubLogin: "octocat",
        });
        const prisma = {
          userGitHubCredential: { findUnique, update, deleteMany: vi.fn() },
        };

        // GitHub refresh endpoint returns a rotated pair.
        const fetchMock = vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                access_token: "at-fresh-live",
                refresh_token: "rt-rotated",
                expires_in: 28800,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const { getGithubTokenForUser } = await import(
          "~/server/services/langy/langyGithubToken"
        );
        const minted = await getGithubTokenForUser({
          prisma: prisma as never,
          userId: "u1",
          organizationId: "org1",
        });

        expect(minted?.token).toBe("at-fresh-live");

        // The ONLY thing persisted to Prisma is the ENCRYPTED rotated refresh
        // token — no access-token column, no plaintext.
        expect(update).toHaveBeenCalledTimes(1);
        const updateArg = update.mock.calls[0]?.[0] as {
          data: Record<string, unknown>;
        };
        expect(updateArg.data).toEqual({
          encryptedRefreshToken: "enc(rt-rotated)",
        });
        const persistedBlob = JSON.stringify(updateArg);
        expect(persistedBlob).not.toContain("at-fresh-live"); // no access token at rest
        // The rotated refresh token is stored only as ciphertext — Prisma
        // never receives the plaintext value.
        expect(updateArg.data.encryptedRefreshToken).not.toBe("rt-rotated");
        expect(updateArg.data.encryptedRefreshToken).toBe("enc(rt-rotated)");

        // The access token is cached in Redis with a TTL (EX), never on disk.
        const cacheWrite = redisSet.mock.calls.find(
          (c) => c[0] === "langy:gh:at:u1:org1",
        );
        expect(cacheWrite).toBeDefined();
        expect(cacheWrite).toEqual(
          expect.arrayContaining([
            "langy:gh:at:u1:org1",
            "at-fresh-live",
            "EX",
          ]),
        );
      });
    });

    describe("when I disconnect while a live worker still holds the token", () => {
      /*
       * The TS control plane cannot reach into a running worker's env to pull
       * the token — exactly as the spec says ("the worker still holds the
       * token until it is reaped"). What the control plane CAN do, and what
       * this asserts, is stop serving that token: disconnect clears the
       * access-token cache so no NEW session mints it. The 10-minute idle
       * reaper that finally kills the worker lives in the agent's server.js
       * (LANGY_WORKER_IDLE_MS) and is covered there.
       */
      /** @scenario "Live workers may keep a token until the idle reaper runs" */
      it("clears the cached token on disconnect so no new session can mint, leaving any live worker's in-memory copy untouched", async () => {
        const { clearGithubTokenCache, getGithubTokenForUser } = await import(
          "~/server/services/langy/langyGithubToken"
        );

        // A live worker minted earlier — the token sits in the Redis cache.
        const store = new Map<string, string>([
          ["langy:gh:at:u1:org1", "at-live-in-worker"],
        ]);
        redisGet.mockImplementation(async (k: string) => store.get(k) ?? null);
        redisDel.mockImplementation(async (k: string) => {
          const had = store.delete(k);
          return had ? 1 : 0;
        });

        const findUnique = vi.fn().mockResolvedValue({
          encryptedRefreshToken: "enc(rt-old)",
          githubLogin: "octocat",
        });

        // Before disconnect: a session would be served the cached token.
        const before = await getGithubTokenForUser({
          prisma: { userGitHubCredential: { findUnique } } as never,
          userId: "u1",
          organizationId: "org1",
        });
        expect(before?.token).toBe("at-live-in-worker");

        // Disconnect clears the cache (control plane stops serving the token).
        await clearGithubTokenCache({ userId: "u1", organizationId: "org1" });
        expect(redisDel).toHaveBeenCalledWith("langy:gh:at:u1:org1");
        expect(store.has("langy:gh:at:u1:org1")).toBe(false);

        // The control plane never touched the worker's in-memory copy — it
        // only owns the cache + the at-rest row. That residual-token window
        // (until the idle reaper) is the spec's documented, intentional gap.
      });
    });
  });
});
