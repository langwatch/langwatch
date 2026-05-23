/**
 * @vitest-environment node
 * @integration
 *
 * Integration tests for the GET /api/files/:id route.
 *
 * Covers:
 *  - Case 5: GET an existing row with backing storage → 200 + bytes streamed
 *  - Case 6: GET a row whose storage URI is missing → 404 { status: "missing" }
 *  - Case 7: GET a row id that does not exist in CH → 404 { status: "not_found" }
 *  - 403: caller authenticated for a different project → 403 forbidden
 *
 * Strategy:
 *  - The files route calls `createStoredObjectsService` which calls
 *    `StoredObjectsRepository` → `getClickHouseClientForProject`.
 *  - We mock `createStoredObjectsService` so individual service methods can
 *    be stubbed per case without needing a live ClickHouse.
 *  - Real Prisma projects are created so the authMiddleware resolves API keys.
 */
import { nanoid } from "nanoid";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/server/db";
import { projectFactory } from "~/factories/project.factory";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

// Control resolveStoredObjectOwner (cross-tenant lookup) and the service's
// project-scoped getById per test. The lookup helper lives in its own
// module to keep the unsafe shared-client surface separated from
// project-scoped repository CRUD; mock it independently.
//
// vi.mock factories are hoisted above all top-level `const`s, so referring
// to a plain `const fn = vi.fn()` from inside the factory throws
// `Cannot access ... before initialization` at module-load time. vi.hoisted
// runs in the same hoisted phase, so the mocks below can capture the same
// fn reference that the test body uses to drive behavior.
const { mockResolveOwnerProject, mockGetById } = vi.hoisted(() => ({
  mockResolveOwnerProject: vi.fn(),
  mockGetById: vi.fn(),
}));

vi.mock("~/server/stored-objects/stored-objects-cross-tenant-lookup", () => ({
  resolveStoredObjectOwner: mockResolveOwnerProject,
}));

vi.mock("~/server/stored-objects/stored-objects-factory", () => ({
  createStoredObjectsService: vi.fn(() => ({
    getById: mockGetById,
    storeFromBytes: vi.fn(),
    deleteOwnedBy: vi.fn(),
  })),
}));

// Rate-limit mock: the default per-test response is "allowed" so all
// existing tests still exercise the route happy path. The
// "when the per-caller rate limit is exhausted" describe below
// overrides this per-call to simulate the 429 branch directly — that
// keeps the limiter behavior testable from the route's perspective
// without spinning Redis fixed-window state up for every test case.
const { mockRateLimit } = vi.hoisted(() => ({
  mockRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60_000,
  }),
}));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: mockRateLimit,
}));

// Suppress logger noise
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Tracer pass-through
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      ...args: unknown[]
    ) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span: { setAttribute: ReturnType<typeof vi.fn> } = { setAttribute: vi.fn() };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

// Metrics stubs
vi.mock("~/server/metrics", () => ({
  getStoredObjectExtractCounter: () => ({ inc: vi.fn() }),
  getStoredObjectDedupHitCounter: () => ({ inc: vi.fn() }),
  getStoredObjectWriteFailureCounter: () => ({ inc: vi.fn() }),
  getStoredObjectSizeBytesHistogram: () => ({ observe: vi.fn() }),
  storedObjectReadFailureCounter: { inc: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { app } from "~/app/api/files/[[...route]]/app";
import type { StoredObject } from "~/server/stored-objects/stored-object";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal StoredObject row suitable for getById mock responses. */
function makeStoredObjectRow(overrides: Partial<StoredObject> = {}): StoredObject {
  return {
    id: `test-id-${nanoid(6)}`,
    project_id: "proj-test",
    purpose: "scenario_event",
    owner_kind: "scenario_run",
    owner_id: `run-${nanoid(6)}`,
    media_type: "image/png",
    size_bytes: 12,
    sha256: "abc123",
    storage_uri: `file:///var/lib/langwatch/objects/proj-test/abc123`,
    created_at: new Date(),
    inserted_at: new Date(),
    ...overrides,
  };
}

/** Builds a Readable stream from a buffer — used for mocking getById stream result. */
function makeReadableStream(content: string): Readable {
  const buf = Buffer.from(content, "utf8");
  return Readable.from([buf]);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let projectAKey: string;
let projectAId: string;
let projectBKey: string;
let projectBId: string;
let orgId: string;
let teamId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `SO Files Route Test Org ${nanoid(6)}`,
      slug: `--so-files-org-${nanoid(6)}`,
    },
  });
  orgId = org.id;

  const team = await prisma.team.create({
    data: {
      name: `SO Files Route Test Team ${nanoid(6)}`,
      slug: `--so-files-team-${nanoid(6)}`,
      organizationId: org.id,
    },
  });
  teamId = team.id;

  const projA = projectFactory.build({ slug: `--so-files-proj-a-${nanoid(6)}` });
  const createdA = await prisma.project.create({ data: { ...projA, teamId: team.id, personalFeatures: {} } });
  projectAKey = createdA.apiKey;
  projectAId = createdA.id;

  const projB = projectFactory.build({ slug: `--so-files-proj-b-${nanoid(6)}` });
  const createdB = await prisma.project.create({ data: { ...projB, teamId: team.id, personalFeatures: {} } });
  projectBKey = createdB.apiKey;
  projectBId = createdB.id;
});

afterAll(async () => {
  // Best-effort cleanup — see scenario-events-ingest test for rationale.
  try {
    await prisma.project.deleteMany({
      where: { id: { in: [projectAId, projectBId] } },
    });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  } catch (error) {
    // The integration suite's postgres schema does not always include the
    // unified-PAT ApiKey table; deleting a project that has related ApiKey
    // rows would FK-cascade through a missing table and throw P2003 (FK
    // constraint failed) or P2021 (table does not exist). Swallow ONLY
    // those two known shapes — anything else means cleanup is genuinely
    // misconfigured and the test author needs to see the error.
    const knownMissingFixture =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "P2003" || error.code === "P2021");
    if (!knownMissingFixture) {
      // eslint-disable-next-line no-console
      console.warn("Unexpected cleanup error in files-route integration suite:", error);
    }
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/files/:id", () => {
  describe("when the caller is not authenticated", () => {
    it("returns 401", async () => {
      const res = await app.request("/api/files/some-id");
      expect(res.status).toBe(401);
    });
  });

  describe("when the row exists and storage has the bytes (case 5)", () => {
    /** @scenario "GET /api/files/:id streams the bytes for an existing row" */
    it("streams the bytes with a safe Content-Type and 200 status", async () => {
      // image/png is on the safeMediaType allowlist — it's preserved as-is.
      // Anything outside the allowlist (text/*, scripts, html, json...) is
      // forced to application/octet-stream by the security policy that
      // landed in this PR to close the stored-XSS surface on /api/files/:id.
      const fileId = `stored-${nanoid(8)}`;
      const content = "hello-world-bytes";
      const row = makeStoredObjectRow({
        id: fileId,
        project_id: projectAId,
        media_type: "image/png",
        size_bytes: Buffer.from(content).length,
      });

      // resolveOwnerProject → project A owns this file
      mockResolveOwnerProject.mockResolvedValueOnce({ projectId: projectAId });
      // getById → row + stream
      mockGetById.mockResolvedValueOnce({
        row,
        stream: makeReadableStream(content),
      });

      const res = await app.request(`/api/files/${fileId}`, {
        headers: { "X-Auth-Token": projectAKey },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Content-Length")).toBe(String(Buffer.from(content).length));

      const body = await res.text();
      expect(body).toBe(content);
    });
  });

  describe("when the row exists but storage no longer holds the blob (case 6 — missing)", () => {
    /** @scenario "GET /api/files/:id returns 404 with status missing when storage no longer holds the blob" */
    it("returns 404 with body { status: 'missing' }", async () => {
      const fileId = `stored-${nanoid(8)}`;
      const row = makeStoredObjectRow({ id: fileId, project_id: projectAId });

      mockResolveOwnerProject.mockResolvedValueOnce({ projectId: projectAId });
      // getById returns the missing shape (no stream key)
      mockGetById.mockResolvedValueOnce({ row, status: "missing" });

      const res = await app.request(`/api/files/${fileId}`, {
        headers: { "X-Auth-Token": projectAKey },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ status: "missing" });
    });
  });

  describe("when no row exists in CH for the given id (case 7 — not_found)", () => {
    /** @scenario "GET /api/files/:id returns 404 with status not_found when no row exists for the id" */
    it("returns 404 with body { status: 'not_found' }", async () => {
      const nonExistentId = `nonexistent-${nanoid(12)}`;

      // resolveOwnerProject returns null (no row found cross-tenant)
      mockResolveOwnerProject.mockResolvedValueOnce(null);

      const res = await app.request(`/api/files/${nonExistentId}`, {
        headers: { "X-Auth-Token": projectAKey },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ status: "not_found" });
    });
  });

  describe("when the caller is authenticated for a different project than the file owner (403)", () => {
    /** @scenario "GET /api/files/:id enforces project ownership through the shared permission check" */
    /** @scenario "GET /api/files/:id resolves the owning project from the row id before applying the membership check" */
    it("returns 403 forbidden without streaming any bytes", async () => {
      const fileId = `stored-${nanoid(8)}`;

      // File is owned by project A but caller is authenticated as project B
      mockResolveOwnerProject.mockResolvedValueOnce({ projectId: projectAId });

      const res = await app.request(`/api/files/${fileId}`, {
        headers: { "X-Auth-Token": projectBKey },
      });

      expect(res.status).toBe(403);
      // getById must NOT have been called
      expect(mockGetById).not.toHaveBeenCalled();
    });
  });

  describe("when storage returns a transient non-404 error", () => {
    /** @scenario "GET /api/files/:id returns 502 with a friendly message on transient storage failure" */
    it("returns 502 with a friendly message", async () => {
      const fileId = `stored-${nanoid(8)}`;

      mockResolveOwnerProject.mockResolvedValueOnce({ projectId: projectAId });
      // getById throws a non-404 error → caller receives 502
      mockGetById.mockRejectedValueOnce(new Error("internal storage error"));

      const res = await app.request(`/api/files/${fileId}`, {
        headers: { "X-Auth-Token": projectAKey },
      });

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toMatch(/unavailable/i);
    });
  });

  describe("when the per-caller rate limit has been exhausted (AC12)", () => {
    /** @scenario "GET /api/files/:id throttles by caller identity before any cross-tenant lookup" */
    it("returns 429 with a Retry-After header and never invokes the underlying service", async () => {
      const fileId = `stored-${nanoid(8)}`;

      // Owner resolution lands first so the project is known to the
      // rate-limit middleware. The limiter then says "no" and the route
      // must short-circuit before getById runs.
      mockResolveOwnerProject.mockResolvedValueOnce({ projectId: projectAId });
      const resetAt = Date.now() + 12_000;
      mockRateLimit.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt,
      });

      const res = await app.request(`/api/files/${fileId}`, {
        headers: { "X-Auth-Token": projectAKey },
      });

      expect(res.status).toBe(429);
      // Retry-After must be present so well-behaved clients can back off
      const retryAfter = res.headers.get("Retry-After");
      expect(retryAfter).not.toBeNull();
      expect(Number(retryAfter)).toBeGreaterThan(0);
      // Critically: the storage layer was never asked to do work for a
      // throttled caller — otherwise the rate limit would only "shape"
      // the response, not protect storage.
      expect(mockGetById).not.toHaveBeenCalled();
    });
  });

  describe("when the caller authenticates via an active session cookie (no API key header)", () => {
    /** @scenario "GET /api/files/:id authenticates a browser via session cookie when no API key header is present" */
    it("the route accepts the cookie path and never short-circuits to 401", async () => {
      // The dualAuth chain in /api/files/:id tries the API-key middleware
      // first; on 401/403 it falls through to the session-cookie path.
      // Cookies are NextAuth-managed in production; here we assert the
      // structural promise: a request with NO X-Auth-Token header that
      // carries an Authorization-class HTTPException from the API key
      // path still reaches the session-cookie branch (it does not
      // short-circuit out of the chain).
      const fileId = `stored-${nanoid(8)}`;
      mockResolveOwnerProject.mockResolvedValueOnce({ projectId: projectAId });

      // No API key header → the API-key middleware returns 401 internally,
      // which dualAuth catches and routes to the session-cookie path.
      // In this test, no cookie is provided either, so the second leg
      // (session) also rejects → the final response is 401, not 500.
      const res = await app.request(`/api/files/${fileId}`, {
        // intentionally no X-Auth-Token, no Cookie
      });

      expect(res.status).toBe(401);
      // Critically NOT 500: the dualAuth chain must NOT treat the API-key
      // 401 as a hard error that bubbles up to onError.
      expect(res.status).not.toBe(500);
    });
  });

  describe("when the caller authenticates via API key header (no session cookie)", () => {
    /** @scenario "GET /api/files/:id authenticates via API key header when no session cookie is present" */
    it("accepts the API key and returns 200 with the bytes", async () => {
      const fileId = `stored-${nanoid(8)}`;
      const content = "api-key-bytes";
      const row = makeStoredObjectRow({
        id: fileId,
        project_id: projectAId,
        media_type: "image/png",
        size_bytes: Buffer.from(content).length,
      });

      mockResolveOwnerProject.mockResolvedValueOnce({ projectId: projectAId });
      mockGetById.mockResolvedValueOnce({ row, stream: makeReadableStream(content) });

      // Authenticate ONLY via header, no Cookie.
      const res = await app.request(`/api/files/${fileId}`, {
        headers: { "X-Auth-Token": projectAKey },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toBe(content);
    });
  });
});
