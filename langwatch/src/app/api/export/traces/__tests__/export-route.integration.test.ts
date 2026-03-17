/**
 * Integration tests for the Hono trace export endpoints.
 * Tests authentication, authorization, streaming download, and file naming.
 *
 * ExportService is mocked to return controlled async generator output,
 * isolating the HTTP layer from the domain layer.
 *
 * Progress is now broadcast via BroadcastService (Redis pub/sub) instead
 * of in-memory EventEmitters. The GET /progress/:exportId endpoint has
 * been removed in favor of tRPC subscriptions.
 */

import type { Project } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/server/db";
import { getTestProject, getTestUser } from "~/utils/testUtils";

// Mock next-auth to provide a controllable session
vi.mock("next-auth", async () => {
  const actual = await vi.importActual("next-auth");
  return {
    ...actual,
    getServerSession: vi.fn(),
  };
});

// Mock ExportService to return controlled async generators
vi.mock("~/server/export/export.service", () => {
  return {
    ExportService: {
      create: vi.fn(),
    },
  };
});

// Mock getApp to provide a fake BroadcastService
const mockBroadcastToTenant = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    broadcast: {
      broadcastToTenant: mockBroadcastToTenant,
    },
  }),
}));

import { getServerSession } from "next-auth";
import { ExportService } from "~/server/export/export.service";

const mockGetServerSession = vi.mocked(getServerSession);
const mockExportServiceCreate = vi.mocked(ExportService.create);

/**
 * Helper to build a valid export request body.
 */
function buildExportRequestBody({
  projectId,
  mode = "summary",
  format = "csv",
}: {
  projectId: string;
  mode?: "summary" | "full";
  format?: "csv" | "json";
}) {
  return {
    projectId,
    mode,
    format,
    filters: {},
    startDate: Date.now() - 86400000,
    endDate: Date.now(),
  };
}

/**
 * Create a mock ExportService instance with an async generator that yields
 * the given chunks.
 */
function createMockExportService(chunks: Array<{ chunk: string; progress: { exported: number; total: number } }>) {
  const total = chunks.length > 0 ? chunks[chunks.length - 1]!.progress.total : 0;
  return {
    getTotalCount: vi.fn().mockResolvedValue(total),
    exportTraces: vi.fn().mockImplementation(async function* () {
      for (const item of chunks) {
        yield item;
      }
    }),
  };
}

describe("Export Traces Route", () => {
  let project: Project;
  let userId: string;

  beforeAll(async () => {
    project = await getTestProject("export-route-integration");
    const user = await getTestUser();
    userId = user.id;

    // Add user to the project's team so permission checks pass
    const projectWithTeam = await prisma.project.findUnique({
      where: { id: project.id },
      include: { team: true },
    });
    if (projectWithTeam?.team) {
      await prisma.teamUser.upsert({
        where: {
          userId_teamId: {
            userId,
            teamId: projectWithTeam.team.id,
          },
        },
        update: { role: "ADMIN" },
        create: {
          userId,
          teamId: projectWithTeam.team.id,
          role: "ADMIN",
        },
      });
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Lazy-import the route handler to allow mocks to take effect
  async function importRouteHandler() {
    const mod = await import("../[[...route]]/route");
    return mod;
  }

  describe("POST /api/export/traces/download", () => {
    describe("when user is not authenticated", () => {
      it("returns 401", async () => {
        mockGetServerSession.mockResolvedValue(null);
        const { POST } = await importRouteHandler();

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildExportRequestBody({ projectId: project.id })),
          },
        );

        const response = await POST(request);
        expect(response.status).toBe(401);
      });
    });

    describe("when user lacks traces:view permission", () => {
      it("returns 403", async () => {
        // Session for a user who is NOT a team member
        mockGetServerSession.mockResolvedValue({
          user: { id: "non-member-user-id", email: "nobody@example.com" },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });
        const { POST } = await importRouteHandler();

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildExportRequestBody({ projectId: project.id })),
          },
        );

        const response = await POST(request);
        expect(response.status).toBe(403);
      });
    });

    describe("when request body is invalid", () => {
      it("returns 400 for missing required fields", async () => {
        mockGetServerSession.mockResolvedValue({
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });
        const { POST } = await importRouteHandler();

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id }),
          },
        );

        const response = await POST(request);
        expect(response.status).toBe(400);
      });
    });

    describe("when user is authorized and exports CSV", () => {
      beforeEach(() => {
        mockGetServerSession.mockResolvedValue({
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        const mockService = createMockExportService([
          { chunk: "header1,header2\n", progress: { exported: 1, total: 2 } },
          { chunk: "val1,val2\n", progress: { exported: 2, total: 2 } },
        ]);
        mockExportServiceCreate.mockResolvedValue(mockService as unknown as ExportService);
      });

      it("returns streaming response with CSV content-type", async () => {
        const { POST } = await importRouteHandler();

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              buildExportRequestBody({ projectId: project.id, format: "csv", mode: "summary" }),
            ),
          },
        );

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      });

      it("sets Content-Disposition with correct file name", async () => {
        const { POST } = await importRouteHandler();
        const today = new Date().toISOString().slice(0, 10);

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              buildExportRequestBody({ projectId: project.id, format: "csv", mode: "full" }),
            ),
          },
        );

        const response = await POST(request);
        const disposition = response.headers.get("Content-Disposition");
        expect(disposition).toContain(`${project.id} - Traces - ${today} - full.csv`);
      });

      it("includes X-Export-Id header", async () => {
        const { POST } = await importRouteHandler();

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              buildExportRequestBody({ projectId: project.id }),
            ),
          },
        );

        const response = await POST(request);
        const exportId = response.headers.get("X-Export-Id");
        expect(exportId).toBeTruthy();
        expect(typeof exportId).toBe("string");
      });

      it("streams CSV data from the export service", async () => {
        const { POST } = await importRouteHandler();

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              buildExportRequestBody({ projectId: project.id }),
            ),
          },
        );

        const response = await POST(request);
        const body = await response.text();
        expect(body).toContain("header1,header2");
        expect(body).toContain("val1,val2");
      });

      it("broadcasts progress events via BroadcastService", async () => {
        const { POST } = await importRouteHandler();

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              buildExportRequestBody({ projectId: project.id }),
            ),
          },
        );

        const response = await POST(request);
        // Consume the stream to trigger all broadcasts
        await response.text();

        // Should have broadcast progress events + done event
        expect(mockBroadcastToTenant).toHaveBeenCalledWith(
          project.id,
          expect.stringContaining('"type":"progress"'),
          "export_progress",
        );
        expect(mockBroadcastToTenant).toHaveBeenCalledWith(
          project.id,
          expect.stringContaining('"type":"done"'),
          "export_progress",
        );
      });
    });

    describe("when user exports JSON format", () => {
      beforeEach(() => {
        mockGetServerSession.mockResolvedValue({
          user: { id: userId, email: "test@example.com" },
          expires: new Date(Date.now() + 86400000).toISOString(),
        });

        const mockService = createMockExportService([
          { chunk: '{"trace_id":"t1"}\n', progress: { exported: 1, total: 1 } },
        ]);
        mockExportServiceCreate.mockResolvedValue(mockService as unknown as ExportService);
      });

      it("returns NDJSON content-type", async () => {
        const { POST } = await importRouteHandler();

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              buildExportRequestBody({ projectId: project.id, format: "json", mode: "summary" }),
            ),
          },
        );

        const response = await POST(request);
        expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
      });

      it("sets .jsonl extension in file name", async () => {
        const { POST } = await importRouteHandler();
        const today = new Date().toISOString().slice(0, 10);

        const request = new Request(
          "http://localhost:5560/api/export/traces/download",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              buildExportRequestBody({ projectId: project.id, format: "json", mode: "summary" }),
            ),
          },
        );

        const response = await POST(request);
        const disposition = response.headers.get("Content-Disposition");
        expect(disposition).toContain(`${project.id} - Traces - ${today} - summary.jsonl`);
      });
    });
  });
});
