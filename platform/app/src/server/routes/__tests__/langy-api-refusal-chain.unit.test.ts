/**
 * @vitest-environment node
 *
 * The refusal chain of `/api/langy`, driven through the real Hono app.
 *
 * This route's whole design rests on WHICH refusal a caller gets and in what
 * ORDER, and until now nothing tested that — only the two extracted pure
 * helpers had coverage. The properties below were argued in a docblock and
 * verified by hand in review; each one is now pinned by a test, because the
 * cost of getting one wrong is a customer-visible information leak that no
 * typecheck can catch.
 *
 * The two that matter most, and are easy to break by reordering four lines:
 *
 *   - Flag OFF with a valid key answers with Hono's DEFAULT 404 — the same
 *     status, body and Content-Type an unmounted path returns. A thrown 404
 *     would come back as the canonical JSON envelope carrying `trace_id`, and
 *     that envelope is itself the leak the dark surface exists to prevent.
 *   - The flag is checked BEFORE the `langy:create` ceiling. Behind it, a key
 *     lacking the permission got a 403 while the surface was supposed to be
 *     dark — a refusal no unmounted route can produce.
 *
 * The uncredentialed case is pinned too, and it deliberately asserts a 401
 * rather than parity with an unmounted path: the flag is evaluated per project
 * (`distinctId: resolved.project.id`), so with no credential there is no
 * project to evaluate it against and the dark check cannot run. What the dark
 * surface hides is the Langy feature from CREDENTIALED callers; that an
 * authenticated route lives at this path is already true of every guarded
 * route on this API. The test records that boundary so nobody later reads the
 * dark 404 as a defence against anonymous route enumeration.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Auth mocks ───────────────────────────────────────────────────────────────
// The route builds a module-scope `tokenResolver = TokenResolver.create(prisma)`,
// so TokenResolver must be mocked before the route module is imported.
const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();

vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: vi.fn(() => ({ resolve: mockResolve, markUsed: mockMarkUsed })),
  },
}));

const mockExtractCredentials = vi.fn();
const mockEnforceApiKeyCeiling = vi.fn();

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    extractCredentials: (...args: unknown[]) => mockExtractCredentials(...args),
    enforceApiKeyCeiling: (...args: unknown[]) =>
      mockEnforceApiKeyCeiling(...args),
  };
});

vi.mock("~/server/db", () => ({ prisma: {} }));

// ─── Feature flag ─────────────────────────────────────────────────────────────
const mockIsEnabled = vi.fn();

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => mockIsEnabled(...args),
  },
}));

// ─── Identity bridge ──────────────────────────────────────────────────────────
const mockResolveLangyKeyIdentity = vi.fn();
const mockResolveLangyActorSession = vi.fn();

vi.mock("~/server/app-layer/langy/langyApiKeyIdentity", () => ({
  resolveLangyKeyIdentity: (...args: unknown[]) =>
    mockResolveLangyKeyIdentity(...args),
}));

vi.mock("~/server/app-layer/langy/langyApiKeyActorSession", () => ({
  resolveLangyActorSession: (...args: unknown[]) =>
    mockResolveLangyActorSession(...args),
}));

// ─── App layer ────────────────────────────────────────────────────────────────
const mockStartConversationTurn = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    langy: { turns: { startConversationTurn: mockStartConversationTurn } },
  })),
}));

// ─── App under test ───────────────────────────────────────────────────────────
// Imported AFTER every mock so the module-scope TokenResolver.create(prisma)
// picks up the mock rather than the real client.
const { app: langyApp } = await import("../langy-api");

const testApp = new Hono();
testApp.route("/", langyApp);

const TURN_URL = "http://localhost/api/langy/conversations";
// Same app, a path that was never registered — the ground truth the dark
// surface has to match. Sharing the app matters: a separate bare Hono would
// not prove that no handler in THIS chain overrides the default 404.
const UNMOUNTED_URL = "http://localhost/api/langy/not-a-real-route";

const fakeResolved = {
  type: "apiKey" as const,
  apiKeyId: "key-1",
  project: { id: "project-123", team: { organizationId: "org-1" } },
};

const VALID_TURN_BODY = {
  idempotencyKey: "idem-1",
  messages: [{ role: "user", content: "hi" }],
};

function postTurn(body: unknown = VALID_TURN_BODY) {
  return testApp.request(TURN_URL, {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function describeResponse(res: Response) {
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: await res.text(),
  };
}

describe("/api/langy refusal chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractCredentials.mockReturnValue({
      token: "test-token",
      projectId: "project-123",
    });
    mockResolve.mockResolvedValue(fakeResolved);
    mockIsEnabled.mockResolvedValue(true);
    mockEnforceApiKeyCeiling.mockResolvedValue(undefined);
    mockResolveLangyKeyIdentity.mockResolvedValue({
      ok: true,
      userId: "user-1",
    });
    mockResolveLangyActorSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    mockStartConversationTurn.mockResolvedValue({ conversationId: "conv-1" });
  });

  describe("dark surface (flag off)", () => {
    beforeEach(() => {
      mockIsEnabled.mockResolvedValue(false);
    });

    it("answers a valid credential with the SAME response an unmounted path gives", async () => {
      const dark = await describeResponse(await postTurn());
      const unmounted = await describeResponse(
        await testApp.request(UNMOUNTED_URL, { method: "POST" }),
      );

      expect(dark).toEqual(unmounted);
      expect(dark.status).toBe(404);
      // Guards the specific regression: a THROWN 404 serialises through
      // createServiceApp's onError as canonical JSON with a trace id.
      expect(dark.contentType).not.toContain("application/json");
      expect(dark.body).not.toContain("trace_id");
    });

    it("does not reach the ceiling, the identity bridge, or the turn service", async () => {
      await postTurn();

      // Ordering, stated as behaviour: everything downstream of the flag is
      // untouched, so no downstream refusal can betray the surface.
      expect(mockEnforceApiKeyCeiling).not.toHaveBeenCalled();
      expect(mockResolveLangyKeyIdentity).not.toHaveBeenCalled();
      expect(mockStartConversationTurn).not.toHaveBeenCalled();
    });

    it("stays dark for a key that would fail the langy:create ceiling", async () => {
      // The exact case that used to leak: ceiling first meant a 403 escaped a
      // surface that is supposed to be indistinguishable from unmounted.
      mockEnforceApiKeyCeiling.mockRejectedValue(
        new Error("ceiling should never be consulted while dark"),
      );

      const res = await postTurn();

      expect(res.status).toBe(404);
      expect(mockEnforceApiKeyCeiling).not.toHaveBeenCalled();
    });

    it("still refuses a bad credential with 401, before the flag is consulted", async () => {
      mockResolve.mockResolvedValue(null);

      const res = await postTurn();

      expect(res.status).toBe(401);
      expect(mockIsEnabled).not.toHaveBeenCalled();
    });

    it("refuses a missing credential with 401, not the dark 404", async () => {
      // Documented boundary, not an oversight — see the file docblock. A
      // per-project flag cannot be evaluated with no project in hand.
      mockExtractCredentials.mockReturnValue(null);

      const res = await postTurn();

      expect(res.status).toBe(401);
      expect(mockIsEnabled).not.toHaveBeenCalled();
    });
  });

  describe("open surface (flag on)", () => {
    it("lets the ceiling denial through untranslated", async () => {
      const { ApiKeyPermissionDeniedError } = await import(
        "~/server/api-key/errors"
      );
      mockEnforceApiKeyCeiling.mockRejectedValue(
        new ApiKeyPermissionDeniedError("langy:create"),
      );

      const res = await postTurn();
      const body = (await res.json()) as { error?: { code?: string } };

      expect(res.status).toBe(403);
      // ADR-045: the HandledError's own code survives to the caller rather
      // than being reserialised into a bespoke shape.
      expect(JSON.stringify(body)).toContain("api_key_permission_denied");
      expect(mockEnforceApiKeyCeiling).toHaveBeenCalled();
    });

    it("refuses a key with no owning user as 403", async () => {
      mockResolveLangyKeyIdentity.mockResolvedValue({
        ok: false,
        reason: "unowned",
        message: "no owner",
      });

      const res = await postTurn();

      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toContain(
        "langy_api_key_unowned",
      );
    });

    it("refuses an owner without Langy access as 403", async () => {
      mockResolveLangyKeyIdentity.mockResolvedValue({
        ok: false,
        reason: "no_langy_access",
        message: "no access",
      });

      const res = await postTurn();

      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toContain(
        "langy_api_key_no_langy_access",
      );
    });

    it("refuses a vanished actor row as 403", async () => {
      mockResolveLangyActorSession.mockResolvedValue({
        ok: false,
        message: "gone",
      });

      const res = await postTurn();

      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toContain(
        "langy_api_actor_missing",
      );
    });

    it("refuses an invalid body as 400 without dispatching a turn", async () => {
      const res = await postTurn({
        ...VALID_TURN_BODY,
        messages: "not-an-array",
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain(
        "langy_api_request_invalid",
      );
      expect(mockStartConversationTurn).not.toHaveBeenCalled();
    });

    it("accepts a well-formed turn with 202", async () => {
      const res = await postTurn();

      // 202, not 200: the turn is dispatched and the answer does not exist yet.
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ conversationId: "conv-1" });
      expect(mockMarkUsed).toHaveBeenCalledWith({ apiKeyId: "key-1" });
    });
  });
});
