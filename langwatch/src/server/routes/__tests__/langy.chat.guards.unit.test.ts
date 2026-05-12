import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetServerAuthSession = vi.fn();
const mockHasProjectPermission = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) =>
    mockGetServerAuthSession(...args),
}));

vi.mock("~/server/api/rbac", () => ({
  hasProjectPermission: (...args: unknown[]) =>
    mockHasProjectPermission(...args),
}));

vi.mock("~/server/middleware/rate-limit-langy", () => ({
  LANGY_TOOL_CALLS_PER_MESSAGE: 5,
  checkLangyMessageRateLimit: (...args: unknown[]) =>
    mockCheckRateLimit(...args),
}));

const { app } = await import("../langy");

const VALID_SESSION = {
  user: { id: "user_test_abc", email: "tester@example.com" },
  expires: "2099-01-01",
} as const;

async function postChat(body: unknown): Promise<Response> {
  return app.request("/api/langy/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
});

describe("POST /api/langy/chat guards — binds langy-baseline.feature § permission gate", () => {
  describe("given no session cookie", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(null);
    });

    describe("when a chat request is posted", () => {
      it("rejects with 401", async () => {
        const res = await postChat({
          messages: [],
          projectId: "proj_demo",
        });
        expect(res.status).toBe(401);
      });

      it("does not call the permission check", async () => {
        await postChat({ messages: [], projectId: "proj_demo" });
        expect(mockHasProjectPermission).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a valid session but no projectId in the body", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(VALID_SESSION);
    });

    describe("when a chat request omits projectId", () => {
      it("rejects with 400", async () => {
        const res = await postChat({ messages: [] });
        expect(res.status).toBe(400);
      });

      it("does not check permissions for an unknown project", async () => {
        await postChat({ messages: [] });
        expect(mockHasProjectPermission).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a valid session and projectId, but the user lacks evaluations:view", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(VALID_SESSION);
      mockHasProjectPermission.mockResolvedValue(false);
    });

    describe("when a chat request is posted to project demo", () => {
      it("rejects with 403", async () => {
        const res = await postChat({
          messages: [],
          projectId: "proj_demo",
        });
        expect(res.status).toBe(403);
      });

      it("checks the evaluations:view permission on the requested project", async () => {
        await postChat({ messages: [], projectId: "proj_demo" });
        expect(mockHasProjectPermission).toHaveBeenCalledWith(
          expect.objectContaining({ session: VALID_SESSION }),
          "proj_demo",
          "evaluations:view",
        );
      });

      it("does not consume rate-limit budget when permission fails", async () => {
        await postChat({ messages: [], projectId: "proj_demo" });
        expect(mockCheckRateLimit).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a valid session and permission, but the rate limiter rejects — binds langy-baseline.feature § rate limit", () => {
    beforeEach(() => {
      mockGetServerAuthSession.mockResolvedValue(VALID_SESSION);
      mockHasProjectPermission.mockResolvedValue(true);
      mockCheckRateLimit.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 30,
      });
    });

    describe("when too many messages have been sent recently", () => {
      it("rejects with 429", async () => {
        const res = await postChat({
          messages: [],
          projectId: "proj_demo",
        });
        expect(res.status).toBe(429);
      });

      it("returns a Retry-After header in seconds", async () => {
        const res = await postChat({
          messages: [],
          projectId: "proj_demo",
        });
        expect(res.headers.get("Retry-After")).toBe("30");
      });
    });
  });
});
