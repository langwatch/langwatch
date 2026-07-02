/**
 * @vitest-environment node
 *
 * Spec: specs/langy/langy-github-prs.feature — "Unconnected user gets a
 * connect card, not an error". Issue: #4747.
 *
 * The connect-card EMISSION decision is the agent worker's: when GH_TOKEN is
 * absent it streams the `[langy:connect-github]` sentinel instead of erroring.
 * What the control-plane (this route) owns — and what this test pins — is the
 * unconnected-user contract on the LangWatch side:
 *
 *   (a) the credentials forwarded to the agent carry NO github token (so the
 *       worker can't mint a PR on the user's behalf), and
 *   (b) a `[langy:connect-github]` sentinel in the agent's streamed reply is
 *       surfaced to the client (relayed as a text delta, NOT stripped to an
 *       error), and
 *   (c) NO pull request side-effects fire: no `langy.github.pr_opened` audit
 *       entry, no per-user PR-cap bump, and the route does NOT report an error
 *       (HTTP 200, the persisted assistant message is non-error prose).
 *
 * The agent /chat call is mocked at the fetch boundary; the services are
 * mocked at their module boundaries. The route is exercised end-to-end through
 * `app.request`, and its stream is drained so we observe real bytes — the strip
 * helper (`stripLangySentinels`) and the PR-link extractor
 * (`extractOpenedPrLinks`) run for real, which is the code path under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The route reads these at handler time; both must be present or it short-
// circuits with a 503 before it ever resolves credentials or calls the agent.
process.env.OPENCODE_AGENT_URL = "http://agent.test";
process.env.LANGY_INTERNAL_SECRET = "internal-secret";

import { CONNECT_GITHUB_SENTINEL } from "../../services/langy/langySentinels";

const getServerAuthSession = vi.fn();
const hasProjectPermission = vi.fn();
const getVercelAIModel = vi.fn();
const auditLog = vi.fn();
const checkLangyMessageRateLimit = vi.fn();
const reserveLangyGithubPrPermit = vi.fn();
const releaseLangyGithubPrPermit = vi.fn();
const featureFlagIsEnabled = vi.fn();

// getOrProvision returns the credentials the route forwards to the agent. The
// unconnected path = no `githubToken` / `githubLogin` keys present.
const getOrProvision = vi.fn();
const getModelsAllowed = vi.fn();

// Conversation + message + tokenizer are real-DB-backed in production; mock
// them so the test never needs Postgres. We capture appended messages to
// assert the persisted assistant body is non-error prose.
const ensureConversation = vi.fn();
const touchConversation = vi.fn();
const appendMessage = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));
vi.mock("~/server/api/rbac", async (importOriginal) => {
  // Other modules pull `Resources` / `Actions` from this module, so keep the
  // real exports and only override the permission gate.
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    hasProjectPermission: (...args: unknown[]) => hasProjectPermission(...args),
  };
});
vi.mock("~/server/modelProviders/utils", () => ({
  getVercelAIModel: (...args: unknown[]) => getVercelAIModel(...args),
}));
vi.mock("~/server/auditLog", () => ({
  auditLog: (...args: unknown[]) => auditLog(...args),
}));
vi.mock("~/server/middleware/rate-limit-langy", () => ({
  checkLangyMessageRateLimit: (...args: unknown[]) =>
    checkLangyMessageRateLimit(...args),
}));
vi.mock("~/server/middleware/rate-limit-langy-github-prs", () => ({
  LANGY_GITHUB_PRS_PER_DAY: 20,
  reserveLangyGithubPrPermit: (...args: unknown[]) =>
    reserveLangyGithubPrPermit(...args),
  releaseLangyGithubPrPermit: (...args: unknown[]) =>
    releaseLangyGithubPrPermit(...args),
}));
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => featureFlagIsEnabled(...args),
  },
}));
vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/server/app-layer/clients/tokenizer/tiktoken.client", () => ({
  TiktokenClient: class {
    async countTokens() {
      return 1;
    }
  },
}));
vi.mock("~/server/services/langy/LangyCredentialService", () => ({
  // Re-exported so `instanceof` in the route's catch still resolves; we never
  // throw it here, but the import must exist.
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
      bumpActivity: (...args: unknown[]) => touchConversation(...args),
    }),
  },
}));
vi.mock("~/server/services/langy/LangyMessageService", async () => {
  // Keep the real extractTextFromParts — the route uses it to build the
  // forwarded prompt + conversation title from the user's parts.
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

/**
 * Build a mock agent /chat Response whose body streams a single OpenCode
 * `message.part.delta` text event carrying `replyText`. This is the exact wire
 * shape the route's `handleLine` decodes (field=text, delta=string).
 */
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

async function postChat() {
  const { app } = await import("../langy");
  return app.request("http://localhost/api/langy/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "p1",
      conversationId: null,
      messages: [
        {
          role: "user",
          parts: [{ type: "text", text: "Open a PR on acme/service-x" }],
        },
      ],
    }),
  });
}

/** Drain a UI-message-stream Response body into one decoded string. */
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

describe("POST /api/langy/chat — unconnected user asks for a PR", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    getServerAuthSession.mockResolvedValue({
      user: { id: "u-unconnected", email: "user@acme.com" },
    });
    hasProjectPermission.mockResolvedValue(true);
    getVercelAIModel.mockResolvedValue({});
    checkLangyMessageRateLimit.mockResolvedValue({ allowed: true });
    // Staff bypass the rollout flag in the middleware; non-staff users would
    // otherwise be 404'd before the handler runs (see langy-route-auth.test).
    // This is a non-staff fixture so we must opt them in via the flag.
    featureFlagIsEnabled.mockResolvedValue(true);
    reserveLangyGithubPrPermit.mockResolvedValue({
      allowed: true,
      remaining: 20,
      resetAt: Date.now() + 86_400_000,
      reserved: true,
    });
    releaseLangyGithubPrPermit.mockResolvedValue(undefined);
    ensureConversation.mockResolvedValue({ id: "conv-1" });
    appendMessage.mockResolvedValue({ id: "msg-1" });
    touchConversation.mockResolvedValue(undefined);

    // The crux of "unconnected": credentials resolve fine for the LLM/MCP but
    // carry NO githubToken / githubLogin. This mirrors
    // LangyCredentialService.getOrProvision when getGithubTokenForUser returns
    // null (user never connected GitHub).
    getOrProvision.mockResolvedValue({
      langwatchApiKey: "sk-lw-test",
      llmVirtualKey: "vk-test",
      langwatchEndpoint: "http://lw.test",
      gatewayBaseUrl: "http://gw.test/v1",
      organizationId: "org-1",
      // intentionally: no githubToken, no githubLogin
    });

    // Agent reply: the worker emits the connect sentinel (because GH_TOKEN was
    // absent in its env) plus plain prose. No PR URL, no `opened` progress
    // sentinel — nothing that should trip the PR cap or pr_opened audit.
    fetchMock = vi.fn(async () =>
      agentStreamResponse(
        `${CONNECT_GITHUB_SENTINEL}\n\nConnect your GitHub account and I'll open that PR for you.`,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  /** @scenario Unconnected user gets a connect card, not an error */
  it("forwards github-less creds, surfaces the connect sentinel, opens no PR", async () => {
    const res = await postChat();

    // (c) The route does not report an error — it streams a normal 200.
    expect(res.status).toBe(200);

    // (a) The credentials forwarded to the agent carry NO github token. Read
    // the actual body the route POSTed to the agent /chat endpoint. The route
    // also preflights a GET to /health before this — same mock, since it
    // returns 200 for any URL — so pick out the /chat call specifically
    // rather than assuming call order.
    const chatCall = fetchMock.mock.calls.find(
      ([url]) => url === "http://agent.test/chat",
    ) as [string, { body: string }] | undefined;
    expect(chatCall).toBeDefined();
    const [agentUrl, agentInit] = chatCall!;
    expect(agentUrl).toBe("http://agent.test/chat");
    const forwarded = JSON.parse(agentInit.body) as {
      credentials: Record<string, unknown>;
    };
    expect(forwarded.credentials.githubToken).toBeUndefined();
    expect(forwarded.credentials.githubLogin).toBeUndefined();

    // (b) The connect sentinel survives into the streamed reply — it is
    // relayed as a text delta to the client (which renders the in-chat Connect
    // GitHub card), NOT swallowed or rewritten into an error string.
    const streamed = await drain(res);
    expect(streamed).toContain(CONNECT_GITHUB_SENTINEL);

    // (c) No PR side-effects: the per-turn permit is RELEASED post-stream
    // (since zero PR URLs were observed in the reply, releasing the slot
    // we pre-reserved keeps a read-only turn from burning a quota), and no
    // `langy.github.pr_opened` audit entry is forged.
    expect(releaseLangyGithubPrPermit).toHaveBeenCalledTimes(1);
    expect(auditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "langy.github.pr_opened" }),
    );

    // The persisted assistant message is non-error prose with the sentinel
    // stripped (history must not re-trigger the card on reload) — it is NOT an
    // error message. Persistence runs inside the stream's execute, so it has
    // resolved by the time drain() returns.
    const assistantAppend = appendMessage.mock.calls
      .map((c) => c[0] as { role: string; parts: { text?: string }[] })
      .find((a) => a.role === "assistant");
    expect(assistantAppend).toBeDefined();
    const persistedText = assistantAppend!.parts
      .map((p) => p.text ?? "")
      .join("");
    expect(persistedText).not.toContain(CONNECT_GITHUB_SENTINEL);
    expect(persistedText).toContain("Connect your GitHub account");
    expect(persistedText.toLowerCase()).not.toContain("an error occurred");
  });
});
