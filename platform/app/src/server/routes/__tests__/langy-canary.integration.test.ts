/**
 * @vitest-environment node
 *
 * @see specs/langy/langy-health-canary.feature
 *
 * Route-level proof for `GET /api/health/langy`, driven through the real Hono
 * app with the same auth seams as `langy-api-refusal-chain.unit.test.ts`: the
 * probe shares the turn routes' authorization chain, so the same mocks stand in
 * for the same boundaries. The canary service's own budget/single-flight logic
 * is unit-tested against an injected boundary in
 * `../../health-probes/__tests__/langy-canary.service.unit.test.ts` — here its
 * production entrypoint (`runLangyHealthCanary`) is mocked as the one boundary
 * this route crosses, so "no turn is started" means "the entrypoint was never
 * invoked".
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRoutePolicy } from "~/server/api/security/route-registry";
import { ApiKeyPermissionDeniedError } from "~/server/api-key/errors";
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

// ─── The one boundary this route crosses ──────────────────────────────────────
const mockRunLangyHealthCanary = vi.fn();

vi.mock("~/server/health-probes/langy-canary.service", () => ({
  runLangyHealthCanary: (...args: unknown[]) =>
    mockRunLangyHealthCanary(...args),
}));

// The sibling probe on the same app is not under test; keep its production
// deps (queues, judge) out of this suite's module graph.
vi.mock("~/server/health-probes/scenario-canary.service", () => ({
  runScenarioHealthCanary: vi.fn(),
}));

// Imported AFTER every mock, same as the sibling suites.
const { app: healthApp } = await import("../health-checks");

const testApp = new Hono();
testApp.route("/", healthApp);

const HEALTH_URL = "http://localhost/api/health/langy";
const UNMOUNTED_URL = "http://localhost/api/health/not-a-real-route";

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

/**
 * Everything a caller could read off a response: status, every header, body.
 * The dark 404 is compared to an unmounted path's through this, so any header
 * the probe adds on its other paths (Cache-Control) counts as a difference. A
 * live probe against a stack with the surface off showed the 404 carries no
 * such header, and a comparator that skipped headers had let the spec promise
 * one anyway; a comparator that picked headers by name would only see the
 * ones its author thought of.
 */
async function describeResponse(res: Response) {
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.text(),
  };
}

describe("GET /api/health/langy", () => {
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

    describe("when GET /api/health/langy is called", () => {
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

    describe("when GET /api/health/langy is called", () => {
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
    beforeEach(() => {
      mockEnforceApiKeyCeiling.mockRejectedValue(
        new ApiKeyPermissionDeniedError("langy:create"),
      );
    });

    describe("when GET /api/health/langy is called", () => {
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

    describe("when GET /api/health/langy is called", () => {
      /** @scenario "A key whose owner is outside the Langy cohort is refused" */
      it("responds 403 with the denial's message in the siblings' shape and starts no turn", async () => {
        const res = await getHealth();

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ message: "no access" });
        expect(mockRunLangyHealthCanary).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the canary reports healthy", () => {
    describe("when GET /api/health/langy is called", () => {
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

    describe("when GET /api/health/langy is called", () => {
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

    describe("when GET /api/health/langy is called", () => {
      /** @scenario "A busy probe answers 429" */
      it("responds 429 with status busy", async () => {
        const res = await getHealth();

        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({ status: "busy" });
      });
    });
  });

  describe("given the health-checks app is loaded", () => {
    describe("when the Langy probe's policy is looked up", () => {
      /** @scenario "The Langy probe is declared public like its sibling health probes" */
      it("registers GET /api/health/langy as a public endpoint that authenticates in-handler, like its siblings", () => {
        const langy = getRoutePolicy("GET", "/api/health/langy");
        const sibling = getRoutePolicy("GET", "/api/health/scenarios");

        expect(langy?.policy.kind).toBe("public");
        expect(langy?.policy).toEqual(sibling?.policy);
      });
    });
  });
});
