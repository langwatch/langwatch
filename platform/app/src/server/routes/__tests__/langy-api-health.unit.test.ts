/**
 * @vitest-environment node
 *
 * @see specs/langy/langy-health-canary.feature
 *
 * Route-level proof for `GET /api/langy/health`, driven through the real Hono
 * app with the same auth seams as the refusal-chain suite next door. The
 * canary service's own budget/single-flight logic is unit-tested against an
 * injected boundary in
 * `../../health-probes/__tests__/langy-canary.service.unit.test.ts` — here its
 * production entrypoint (`runLangyHealthCanary`) is mocked as the one boundary
 * this route crosses, so "no turn is started" means "the entrypoint was never
 * invoked".
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LangyIdentityDenialReason } from "~/server/app-layer/langy/langyApiKeyIdentity";

// ─── Auth mocks (same seam as langy-api-refusal-chain.unit.test.ts) ───────────
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

const mockIsEnabled = vi.fn();

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => mockIsEnabled(...args),
  },
}));

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

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({ langy: { turns: {}, conversations: {} } })),
  tryGetApp: vi.fn(() => null),
}));

// ─── The one boundary this route crosses ──────────────────────────────────────
const mockRunLangyHealthCanary = vi.fn();

vi.mock("~/server/health-probes/langy-canary.service", () => ({
  runLangyHealthCanary: (...args: unknown[]) =>
    mockRunLangyHealthCanary(...args),
}));

// Imported AFTER every mock, same as the sibling suites.
const { app: langyApp } = await import("../langy-api");

const testApp = new Hono();
testApp.route("/", langyApp);

const HEALTH_URL = "http://localhost/api/langy/health";
const UNMOUNTED_URL = "http://localhost/api/langy/not-a-real-route";

const SESSION = { user: { id: "user-1" } };

const fakeResolved = {
  type: "apiKey" as const,
  apiKeyId: "key-1",
  project: { id: "project-123", team: { organizationId: "org-1" } },
};

function getHealth(headers: Record<string, string> = {}) {
  return testApp.request(HEALTH_URL, {
    method: "GET",
    headers: { "X-Auth-Token": "test-token", ...headers },
  });
}

async function describeResponse(res: Response) {
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: await res.text(),
  };
}

describe("GET /api/langy/health", () => {
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
      session: SESSION,
    });
    mockRunLangyHealthCanary.mockResolvedValue({
      healthy: true,
      conversationId: "conv-1",
      turnId: "turn-1",
      durationMs: 1234,
    });
  });

  describe("given a request carrying no project API key", () => {
    beforeEach(() => {
      mockExtractCredentials.mockReturnValue(null);
    });

    describe("when GET /api/langy/health is called", () => {
      /** @scenario "A request with no credential is refused before any turn is started" */
      it("responds 401 and starts no turn", async () => {
        const res = await getHealth();

        expect(res.status).toBe(401);
        expect(mockRunLangyHealthCanary).not.toHaveBeenCalled();
      });

      /** @scenario "Every health response is uncacheable" */
      it("still carries Cache-Control: no-store", async () => {
        const res = await getHealth();

        expect(res.headers.get("cache-control")).toBe("no-store");
      });
    });
  });

  describe("given the Langy API surface flag is off for the key's project", () => {
    beforeEach(() => {
      mockIsEnabled.mockResolvedValue(false);
    });

    describe("when GET /api/langy/health is called", () => {
      /** @scenario "A switched-off surface answers the health check as a route that does not exist" */
      it("answers byte-identically to an unmounted path and starts no turn", async () => {
        const dark = await describeResponse(await getHealth());
        const unmounted = await describeResponse(
          await testApp.request(UNMOUNTED_URL, { method: "GET" }),
        );

        expect(dark).toEqual(unmounted);
        expect(dark.status).toBe(404);
        expect(mockRunLangyHealthCanary).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a project API key that does not clear the langy:create ceiling", () => {
    beforeEach(async () => {
      const { ApiKeyPermissionDeniedError } = await import(
        "~/server/api-key/errors"
      );
      mockEnforceApiKeyCeiling.mockRejectedValue(
        new ApiKeyPermissionDeniedError("langy:create"),
      );
    });

    describe("when GET /api/langy/health is called", () => {
      /** @scenario "A key without langy:create is refused" */
      it("responds 403 and starts no turn", async () => {
        const res = await getHealth();

        expect(res.status).toBe(403);
        expect(mockRunLangyHealthCanary).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a project API key owned by a user without Langy access", () => {
    beforeEach(() => {
      mockResolveLangyKeyIdentity.mockResolvedValue({
        ok: false,
        reason: "no-access" satisfies LangyIdentityDenialReason,
        message: "no access",
      });
    });

    describe("when GET /api/langy/health is called", () => {
      /** @scenario "A key whose owner is outside the Langy cohort is refused" */
      it("responds 403 with the cohort denial code and starts no turn", async () => {
        const res = await getHealth();

        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe("langy_api_key_no_langy_access");
        expect(mockRunLangyHealthCanary).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the canary reports healthy", () => {
    describe("when GET /api/langy/health is called", () => {
      /** @scenario "A healthy run answers 200 with the turn's ids" */
      it("responds 200 with status ok and the turn's ids, as the key's owner", async () => {
        const res = await getHealth();

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          status: "ok",
          conversationId: "conv-1",
          turnId: "turn-1",
          durationMs: 1234,
        });
        expect(mockRunLangyHealthCanary).toHaveBeenCalledWith({
          projectId: "project-123",
          session: SESSION,
        });
        expect(mockMarkUsed).toHaveBeenCalledWith({ apiKeyId: "key-1" });
      });

      /** @scenario "Every health response is uncacheable" */
      it("carries Cache-Control: no-store", async () => {
        const res = await getHealth();

        expect(res.headers.get("cache-control")).toBe("no-store");
      });
    });
  });

  describe("given the canary reports unhealthy with reason empty_reply", () => {
    beforeEach(() => {
      mockRunLangyHealthCanary.mockResolvedValue({
        healthy: false,
        reason: "empty_reply",
        conversationId: "conv-1",
        turnId: "turn-1",
        durationMs: 4321,
      });
    });

    describe("when GET /api/langy/health is called", () => {
      /** @scenario "An unhealthy run answers 503 with its reason" */
      it("responds 503 with status unhealthy and the reason", async () => {
        const res = await getHealth();

        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({
          status: "unhealthy",
          reason: "empty_reply",
          conversationId: "conv-1",
          turnId: "turn-1",
          durationMs: 4321,
        });
      });

      /** @scenario "Every health response is uncacheable" */
      it("carries Cache-Control: no-store", async () => {
        const res = await getHealth();

        expect(res.headers.get("cache-control")).toBe("no-store");
      });
    });
  });

  describe("given the canary reports busy", () => {
    beforeEach(() => {
      mockRunLangyHealthCanary.mockResolvedValue({ busy: true });
    });

    describe("when GET /api/langy/health is called", () => {
      /** @scenario "A busy probe answers 429" */
      it("responds 429 with status busy", async () => {
        const res = await getHealth();

        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({ status: "busy" });
      });
    });
  });

  describe("given the Langy API app is loaded", () => {
    describe("when the health route's policy is looked up", () => {
      /** @scenario "The health route is registered under the same policy as the turn routes" */
      it("registers GET /api/langy/health under the same handler-managed langy:create policy as the turn route", async () => {
        const { getRoutePolicy } = await import(
          "~/server/api/security/route-registry"
        );

        const health = getRoutePolicy("GET", "/api/langy/health");
        const turn = getRoutePolicy("POST", "/api/langy/conversations");

        expect(health?.policy).toMatchObject({
          kind: "handlerManaged",
          credential: "apiKey",
          permissions: ["langy:create"],
        });
        expect(health?.policy).toEqual(turn?.policy);
      });
    });
  });
});
