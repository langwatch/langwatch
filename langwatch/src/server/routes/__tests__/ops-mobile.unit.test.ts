/**
 * HTTP-level tests for the mobile ops API. Requests go through the real Hono
 * app so the auth guard, the query parsing and the status codes are exercised
 * as a client would meet them; only the boundaries — Redis, Prisma, the ops
 * app layer and the admin allow-list — are mocked.
 *
 * Spec: specs/ops/mobile-ops-api.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const redisGet = vi.fn();
const redisDel = vi.fn();

vi.mock("~/server/redis", () => ({
  connection: {
    get: (...args: unknown[]) => redisGet(...args),
    del: (...args: unknown[]) => redisDel(...args),
  },
}));

const findUniqueUser = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) } },
}));

const isAdminEmail = vi.fn();

vi.mock("../../../../ee/admin/isAdmin", () => ({
  isAdmin: ({ email }: { email?: string | null }) => isAdminEmail(email),
}));

const opsDependencies = {
  queues: {
    getQueues: vi.fn(),
    getAllDlqGroups: vi.fn(),
    getGroups: vi.fn(),
  },
  scheduler: { listScheduledJobs: vi.fn() },
  blobStore: { runCleanup: vi.fn(), getStats: vi.fn() },
  replay: { getStatus: vi.fn(), getHistory: vi.fn() },
  metricsCollector: {
    getDashboardData: vi.fn(),
    getBadgeCounts: vi.fn(),
  },
} as Record<string, unknown>;

let opsAvailable = true;

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ ops: opsAvailable ? opsDependencies : undefined }),
}));

const { app } = await import("../ops-mobile");

const VALID_TOKEN = "lw_at_test-token";
const OPERATOR_EMAIL = "operator@langwatch.ai";

function authHeaders(token = VALID_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Plant a live device-flow access token for `email`. */
function givenSignedIn({
  email = OPERATOR_EMAIL,
  isOps = true,
}: { email?: string; isOps?: boolean } = {}) {
  redisGet.mockResolvedValue(
    JSON.stringify({
      user_id: "user-1",
      organization_id: "org-1",
      issued_at: Date.now() - 1000,
      expires_at: Date.now() + 60_000,
    }),
  );
  findUniqueUser.mockResolvedValue({ id: "user-1", email });
  isAdminEmail.mockImplementation((e: string | null) => isOps && e === email);
}

function request(path: string, init?: RequestInit) {
  return app.request(`http://localhost/api/ops/mobile${path}`, init);
}

describe("mobile ops API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsAvailable = true;
    (opsDependencies.metricsCollector as { getDashboardData: ReturnType<typeof vi.fn> })
      .getDashboardData.mockReturnValue({ throughputHistory: [], queues: [] });
  });

  describe("given no credentials", () => {
    describe("when a data endpoint is requested", () => {
      it("refuses with 401", async () => {
        const res = await request("/dashboard");

        expect(res.status).toBe(401);
      });

      it("does not reach the ops services", async () => {
        await request("/queues");

        expect(
          (opsDependencies.queues as { getQueues: ReturnType<typeof vi.fn> }).getQueues,
        ).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a session cookie instead of a bearer token", () => {
    describe("when a data endpoint is requested", () => {
      it("refuses with 401", async () => {
        const res = await request("/dashboard", {
          headers: { cookie: "next-auth.session-token=whatever" },
        });

        expect(res.status).toBe(401);
      });
    });
  });

  describe("given an expired access token", () => {
    describe("when a data endpoint is requested", () => {
      it("refuses with 401 and discards the stored token", async () => {
        redisGet.mockResolvedValue(
          JSON.stringify({
            user_id: "user-1",
            organization_id: "org-1",
            issued_at: Date.now() - 10_000,
            expires_at: Date.now() - 1_000,
          }),
        );

        const res = await request("/dashboard", { headers: authHeaders() });

        expect(res.status).toBe(401);
        expect(redisDel).toHaveBeenCalledWith(`lwcli:access:${VALID_TOKEN}`);
      });
    });
  });

  describe("given a signed-in user without ops access", () => {
    describe("when a data endpoint is requested", () => {
      it("refuses with 403 and says what is missing", async () => {
        givenSignedIn({ email: "someone@example.com", isOps: false });

        const res = await request("/dashboard", { headers: authHeaders() });

        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toMatchObject({
          message: expect.stringContaining("ops"),
        });
      });
    });

    describe("when the scope probe is requested", () => {
      it("answers 200 reporting no access, so the app can hide ops quietly", async () => {
        givenSignedIn({ email: "someone@example.com", isOps: false });

        const res = await request("/scope", { headers: authHeaders() });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ hasOpsAccess: false });
      });
    });
  });

  describe("given a signed-in operator", () => {
    beforeEach(() => givenSignedIn());

    describe("when the dashboard is requested", () => {
      it("returns the snapshot", async () => {
        const res = await request("/dashboard", { headers: authHeaders() });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ hasSnapshot: false });
      });
    });

    describe("when the queue list is requested", () => {
      it("returns the queues from the queue service", async () => {
        (
          opsDependencies.queues as { getQueues: ReturnType<typeof vi.fn> }
        ).getQueues.mockResolvedValue([{ name: "q:gq", displayName: "q" }]);

        const res = await request("/queues", { headers: authHeaders() });

        await expect(res.json()).resolves.toEqual({
          queues: [{ name: "q:gq", displayName: "q" }],
        });
      });
    });

    describe("when groups are requested without a queue name", () => {
      it("refuses with 400", async () => {
        const res = await request("/groups", { headers: authHeaders() });

        expect(res.status).toBe(400);
      });
    });

    describe("when groups are requested with a page size above the ceiling", () => {
      it("refuses rather than loading an unbounded page", async () => {
        const res = await request("/groups?queueName=q&pageSize=5000", {
          headers: authHeaders(),
        });

        expect(res.status).toBe(400);
      });
    });

    describe("when the dead letter list is requested", () => {
      it("returns every dead-lettered group across all queues", async () => {
        (
          opsDependencies.queues as { getAllDlqGroups: ReturnType<typeof vi.fn> }
        ).getAllDlqGroups.mockResolvedValue([{ groupId: "g1", queueName: "q:gq" }]);

        const res = await request("/dlq", { headers: authHeaders() });

        await expect(res.json()).resolves.toEqual({
          groups: [{ groupId: "g1", queueName: "q:gq" }],
        });
      });
    });

    describe("when the foundry catalog is requested", () => {
      it("returns the built-in presets", async () => {
        const res = await request("/foundry/presets", { headers: authHeaders() });

        const body = (await res.json()) as { presets: unknown[] };
        expect(body.presets.length).toBeGreaterThan(0);
      });
    });
  });

  describe("given a signed-in operator running a payload store sweep", () => {
    beforeEach(() => {
      givenSignedIn();
      (
        opsDependencies.blobStore as { runCleanup: ReturnType<typeof vi.fn> }
      ).runCleanup.mockResolvedValue({
        queues: [],
        totals: { scanned: 10, reclaimed: 4 },
        dryRun: true,
        durationMs: 5,
      });
    });

    describe("when the sweep is a trial", () => {
      it("runs without a confirmation and reports what it would reclaim", async () => {
        const res = await request("/blobs/sweep", {
          method: "POST",
          headers: { ...authHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({
          totals: { reclaimed: 4 },
        });
        expect(
          (opsDependencies.blobStore as { runCleanup: ReturnType<typeof vi.fn> })
            .runCleanup,
        ).toHaveBeenCalledWith({ dryRun: true, requestedBy: "user-1" });
      });
    });

    describe("when the sweep is for real without a confirmation", () => {
      it("refuses with 400 and reclaims nothing", async () => {
        const res = await request("/blobs/sweep", {
          method: "POST",
          headers: { ...authHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ dryRun: false }),
        });

        expect(res.status).toBe(400);
        expect(
          (opsDependencies.blobStore as { runCleanup: ReturnType<typeof vi.fn> })
            .runCleanup,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when the sweep is for real with the wrong confirmation word", () => {
      it("refuses with 400", async () => {
        const res = await request("/blobs/sweep", {
          method: "POST",
          headers: { ...authHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ dryRun: false, confirm: "DELETE" }),
        });

        expect(res.status).toBe(400);
      });
    });

    describe("when the sweep is for real with the typed confirmation", () => {
      it("runs the destructive sweep against the calling operator", async () => {
        const res = await request("/blobs/sweep", {
          method: "POST",
          headers: { ...authHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ dryRun: false, confirm: "RECLAIM" }),
        });

        expect(res.status).toBe(200);
        expect(
          (opsDependencies.blobStore as { runCleanup: ReturnType<typeof vi.fn> })
            .runCleanup,
        ).toHaveBeenCalledWith({ dryRun: false, requestedBy: "user-1" });
      });
    });

    describe("when the request body is missing entirely", () => {
      it("falls back to a trial rather than a destructive sweep", async () => {
        const res = await request("/blobs/sweep", {
          method: "POST",
          headers: authHeaders(),
        });

        expect(res.status).toBe(200);
        expect(
          (opsDependencies.blobStore as { runCleanup: ReturnType<typeof vi.fn> })
            .runCleanup,
        ).toHaveBeenCalledWith({ dryRun: true, requestedBy: "user-1" });
      });
    });
  });

  describe("given the instance runs without the ops module", () => {
    beforeEach(() => {
      givenSignedIn();
      opsAvailable = false;
    });

    describe("when a data endpoint is requested", () => {
      it("answers 503 saying so, rather than an empty payload", async () => {
        const res = await request("/queues", { headers: authHeaders() });

        expect(res.status).toBe(503);
        await expect(res.json()).resolves.toMatchObject({
          opsModuleAvailable: false,
        });
      });
    });
  });

  describe("the surface a phone is allowed to reach", () => {
    it("exposes no endpoint that starts or cancels a replay", () => {
      const paths = app.routes.map((r) => `${r.method} ${r.path}`);

      expect(paths.filter((p) => /replay/.test(p) && !p.startsWith("GET"))).toEqual(
        [],
      );
    });

    it("exposes no endpoint that mutates a queue or deletes a blob", () => {
      const mutating = app.routes
        .filter((r) => r.method !== "GET" && r.method !== "ALL")
        .map((r) => r.path);

      // The payload store sweep is the single write on this surface.
      expect(mutating).toEqual(["/api/ops/mobile/blobs/sweep"]);
    });
  });
});
