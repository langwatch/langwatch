import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetServerAuthSession = vi.fn();
const mockHasProjectPermission = vi.fn();
const mockGetById = vi.fn();
const mockUpdate = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) =>
    mockGetServerAuthSession(...args),
}));

vi.mock("~/server/api/rbac", () => ({
  hasProjectPermission: (...args: unknown[]) =>
    mockHasProjectPermission(...args),
}));

// Stub the rate-limit module since /langy/chat is registered on the same Hono
// instance and would otherwise try to reach Redis when the module is loaded.
vi.mock("~/server/middleware/rate-limit-langy", () => ({
  LANGY_TOOL_CALLS_PER_MESSAGE: 5,
  checkLangyMessageRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("~/server/services/langy", () => ({
  LangyUserPreferencesService: {
    create: () => ({
      getById: (...args: unknown[]) => mockGetById(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    }),
  },
  // The langy.ts module imports these by name even though the preferences
  // route does not use them — stub minimally so the module loads.
  LangyConversationService: { create: () => ({}) },
  LangyMessageService: { create: () => ({}) },
  LangyProjectMemoryService: { create: () => ({}) },
}));

const { app } = await import("../langy");

const VALID_SESSION = {
  user: { id: "user_test_abc", email: "tester@example.com" },
  expires: "2099-01-01",
} as const;

const BASE_PREFS = {
  id: "pref-1",
  userId: "user_test_abc",
  projectId: "proj_demo",
  mode: "non_expert",
  dismissedSuggestionKinds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetById.mockResolvedValue(BASE_PREFS);
  mockUpdate.mockImplementation(
    async ({
      mode,
      dismissedSuggestionKinds,
    }: {
      mode?: "non_expert" | "expert";
      dismissedSuggestionKinds?: string[];
    }) => ({
      ...BASE_PREFS,
      ...(mode ? { mode } : {}),
      ...(dismissedSuggestionKinds ? { dismissedSuggestionKinds } : {}),
    }),
  );
});

async function getPreferences(projectId?: string): Promise<Response> {
  const query = projectId
    ? `?projectId=${encodeURIComponent(projectId)}`
    : "";
  return app.request(`/api/langy/preferences${query}`);
}

async function putPreferences(body: unknown): Promise<Response> {
  return app.request("/api/langy/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/langy/preferences — binds langy-baseline.feature § Default mode is non-expert", () => {
  describe("given no session cookie", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(null);
    });

    describe("when a request is sent", () => {
      it("rejects with 401", async () => {
        const res = await getPreferences("proj_demo");
        expect(res.status).toBe(401);
      });

      it("does not load preferences", async () => {
        await getPreferences("proj_demo");
        expect(mockGetById).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a session but no projectId", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(VALID_SESSION);
    });

    describe("when projectId is missing", () => {
      it("rejects with 400", async () => {
        const res = await getPreferences();
        expect(res.status).toBe(400);
      });
    });
  });

  describe("given a session without evaluations:view permission", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(VALID_SESSION);
      mockHasProjectPermission.mockResolvedValue(false);
    });

    describe("when a request is sent", () => {
      it("rejects with 403", async () => {
        const res = await getPreferences("proj_demo");
        expect(res.status).toBe(403);
      });
    });
  });

  describe("given a session with permission", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(VALID_SESSION);
      mockHasProjectPermission.mockResolvedValue(true);
    });

    describe("when preferences exist for this user + project", () => {
      it("returns the preferences row", async () => {
        const res = await getPreferences("proj_demo");
        expect(res.status).toBe(200);
        const body = (await res.json()) as { preferences: typeof BASE_PREFS };
        expect(body.preferences.mode).toBe("non_expert");
      });

      it("scopes the lookup to the calling user and project", async () => {
        await getPreferences("proj_demo");
        expect(mockGetById).toHaveBeenCalledWith({
          userId: "user_test_abc",
          projectId: "proj_demo",
        });
      });
    });
  });
});

describe("PUT /api/langy/preferences — binds langy-baseline.feature § Switch to expert mode", () => {
  describe("given a session with permission", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(VALID_SESSION);
      mockHasProjectPermission.mockResolvedValue(true);
    });

    describe("when the body sets mode to expert", () => {
      it("persists the new mode via a single update call", async () => {
        const res = await putPreferences({
          projectId: "proj_demo",
          mode: "expert",
        });
        expect(res.status).toBe(200);
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledWith({
          userId: "user_test_abc",
          projectId: "proj_demo",
          mode: "expert",
          dismissedSuggestionKinds: undefined,
        });
      });

      it("returns the updated preferences in the body", async () => {
        const res = await putPreferences({
          projectId: "proj_demo",
          mode: "expert",
        });
        const body = (await res.json()) as { preferences: typeof BASE_PREFS };
        expect(body.preferences.mode).toBe("expert");
      });
    });

    describe("when both mode and dismissedSuggestionKinds are sent", () => {
      it("forwards both fields in one update call", async () => {
        await putPreferences({
          projectId: "proj_demo",
          mode: "expert",
          dismissedSuggestionKinds: ["pin_prompt"],
        });
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledWith({
          userId: "user_test_abc",
          projectId: "proj_demo",
          mode: "expert",
          dismissedSuggestionKinds: ["pin_prompt"],
        });
      });
    });
  });

  describe("given no session", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(null);
    });

    describe("when a put is attempted", () => {
      it("rejects with 401 and does not update", async () => {
        const res = await putPreferences({
          projectId: "proj_demo",
          mode: "expert",
        });
        expect(res.status).toBe(401);
        expect(mockUpdate).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a malformed body", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(VALID_SESSION);
      mockHasProjectPermission.mockResolvedValue(true);
    });

    describe("when mode is null", () => {
      it("rejects with 400 invalid_body and never reaches the service", async () => {
        const res = await putPreferences({
          projectId: "proj_demo",
          mode: null,
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe("invalid_body");
        expect(mockUpdate).not.toHaveBeenCalled();
      });
    });

    describe("when mode is an unknown string", () => {
      it("rejects with 400 invalid_body", async () => {
        const res = await putPreferences({
          projectId: "proj_demo",
          mode: "godmode",
        });
        expect(res.status).toBe(400);
        expect(mockUpdate).not.toHaveBeenCalled();
      });
    });

    describe("when projectId is missing", () => {
      it("rejects with 400 invalid_body before the auth guard runs", async () => {
        const res = await putPreferences({ mode: "expert" });
        expect(res.status).toBe(400);
        expect(mockHasProjectPermission).not.toHaveBeenCalled();
      });
    });

    describe("when body is not valid JSON", () => {
      it("rejects with 400 invalid_body", async () => {
        const res = await app.request("/api/langy/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        });
        expect(res.status).toBe(400);
        expect(mockUpdate).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a session without permission", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(VALID_SESSION);
      mockHasProjectPermission.mockResolvedValue(false);
    });

    describe("when a put is attempted", () => {
      it("rejects with 403 and does not update", async () => {
        const res = await putPreferences({
          projectId: "proj_demo",
          mode: "expert",
        });
        expect(res.status).toBe(403);
        expect(mockUpdate).not.toHaveBeenCalled();
      });
    });
  });
});
