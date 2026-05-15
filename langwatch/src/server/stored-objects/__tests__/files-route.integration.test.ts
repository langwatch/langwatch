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

// Control resolveOwnerProject and getById per test
const mockResolveOwnerProject = vi.fn();
const mockGetById = vi.fn();

vi.mock("~/server/stored-objects/stored-objects-factory", () => ({
  createStoredObjectsService: vi.fn(() => ({
    resolveOwnerProject: mockResolveOwnerProject,
    getById: mockGetById,
    storeFromBytes: vi.fn(),
    cascadeDeleteProject: vi.fn(),
    cascadeDeleteOwner: vi.fn(),
  })),
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
  const createdA = await prisma.project.create({ data: { ...projA, teamId: team.id } });
  projectAKey = createdA.apiKey;
  projectAId = createdA.id;

  const projB = projectFactory.build({ slug: `--so-files-proj-b-${nanoid(6)}` });
  const createdB = await prisma.project.create({ data: { ...projB, teamId: team.id } });
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
  } catch {
    /* ignore — postgres schema may not include all FK targets in test */
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
    it("streams the bytes with correct Content-Type and 200 status", async () => {
      const fileId = `stored-${nanoid(8)}`;
      const content = "hello-world-bytes";
      const row = makeStoredObjectRow({
        id: fileId,
        project_id: projectAId,
        media_type: "text/plain",
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
      expect(res.headers.get("Content-Type")).toBe("text/plain");
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
});
