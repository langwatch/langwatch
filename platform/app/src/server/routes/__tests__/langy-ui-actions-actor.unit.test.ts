/**
 * @vitest-environment node
 *
 * Who `/api/langy/ui/actions` runs as, driven through the real Hono app.
 *
 * A page action drives the conversation of the person who started it: the
 * visibility check matches the conversation's owner, and the backend fallback
 * persists that id as the editing User. A service key's worker holds an
 * ownerless session key, so the identity bridge resolves it to a key actor
 * whose id names neither the conversation's owner (the parent service key)
 * nor a User row. The route refuses that actor at the door, before any
 * conversation is looked up; the human path is untouched.
 *
 * Spec: specs/langy/langy-ui-actions.feature
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LangyActor } from "~/server/app-layer/langy/langyApiKeyIdentity";

// ─── Auth mocks ───────────────────────────────────────────────────────────────
// The route builds a module-scope `tokenResolver = TokenResolver.create(prisma)`,
// so TokenResolver must be mocked before the route module is imported.
const mockResolve = vi.fn();

vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: vi.fn(() => ({ resolve: mockResolve, markUsed: vi.fn() })),
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
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: vi.fn().mockResolvedValue(true) },
}));

// ─── Identity bridge ──────────────────────────────────────────────────────────
const mockResolveLangyKeyIdentity = vi.fn();

vi.mock("~/server/app-layer/langy/langyApiKeyIdentity", () => ({
  resolveLangyKeyIdentity: (...args: unknown[]) =>
    mockResolveLangyKeyIdentity(...args),
}));

// ─── Dispatch ─────────────────────────────────────────────────────────────────
// The service is the seam: a refused actor must never reach it, and an
// admitted one must reach it as the user the key resolved to.
const mockDispatch = vi.fn();

vi.mock("~/server/app-layer/langy/ui-actions/ui-action.service", () => ({
  // The route `new`s the service, so the double has to be constructible.
  LangyUiActionService: class {
    dispatch = (...args: unknown[]) => mockDispatch(...args);
  },
}));

vi.mock("~/server/app-layer/langy/streaming/langyTokenBuffer", () => ({
  createLangyTokenBuffer: vi.fn(() => ({})),
}));

vi.mock("~/server/app-layer/langy/ui-actions/uiActionBackendExecutor", () => ({
  executeBackendAction: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: vi.fn(() => ({
    redis: {},
    langy: { conversations: {} },
    experiments: {},
  })),
}));

// ─── App under test ───────────────────────────────────────────────────────────
// Imported AFTER every mock so the module-scope TokenResolver.create(prisma)
// picks up the mock rather than the real client.
const { listPageActions } = await import(
  "~/server/app-layer/langy/ui-actions/pageManifests"
);
const { app: uiActionsApp } = await import("../langy-ui-actions");

const testApp = new Hono();
testApp.route("/", uiActionsApp);

const ACTIONS_URL = "http://localhost/api/langy/ui/actions";

const fakeResolved = {
  type: "apiKey" as const,
  apiKeyId: "session-key-1",
  project: {
    id: "project-123",
    slug: "project-123",
    team: { organizationId: "org-1" },
  },
};

// A real kind from the manifest, so the guard is proven to sit BEFORE the
// dispatch rather than being masked by an unknown-kind refusal.
const A_REAL_KIND = listPageActions()[0]!.kind;

function postAction() {
  return testApp.request(ACTIONS_URL, {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId: "conv-1",
      kind: A_REAL_KIND,
      payload: {},
    }),
  });
}

function admitAs(actor: LangyActor) {
  mockResolveLangyKeyIdentity.mockResolvedValue({ ok: true, actor });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExtractCredentials.mockReturnValue({
    token: "test-token",
    projectId: undefined,
  });
  mockResolve.mockResolvedValue(fakeResolved);
  mockEnforceApiKeyCeiling.mockResolvedValue(undefined);
  mockDispatch.mockResolvedValue({ status: "executed", result: null });
});

describe("/api/langy/ui/actions actor", () => {
  describe("given the session key resolves to a service key acting as itself", () => {
    /** @scenario A worker started by a service key cannot drive a page */
    it("refuses the dispatch as 403 before any conversation is looked up", async () => {
      admitAs({ type: "apiKey", id: "service-key-1" });

      const res = await postAction();
      const body = JSON.stringify(await res.json());

      expect(res.status).toBe(403);
      expect(body).toContain("langy_api_key_unowned");
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("refuses the action listing the same way", async () => {
      admitAs({ type: "apiKey", id: "service-key-1" });

      const res = await testApp.request(ACTIONS_URL, {
        method: "GET",
        headers: { "X-Auth-Token": "test-token" },
      });

      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toContain(
        "langy_api_key_unowned",
      );
    });
  });

  describe("given the session key resolves to a user", () => {
    it("dispatches as that user", async () => {
      admitAs({ type: "user", id: "user-1" });

      const res = await postAction();

      expect(res.status).toBe(200);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-123",
          userId: "user-1",
          conversationId: "conv-1",
          kind: A_REAL_KIND,
        }),
      );
    });
  });
});
