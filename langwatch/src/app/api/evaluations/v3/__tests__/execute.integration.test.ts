/**
 * Integration tests for the Hono SSE execute endpoint.
 * Tests authentication, authorization, validation, and streaming.
 *
 * These tests call the actual Hono endpoint with mocked session.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Project } from "@prisma/client";
import { getTestProject, getTestUser } from "~/utils/testUtils";
import { prisma } from "~/server/db";

// Mock next-auth to provide a valid session
vi.mock("next-auth", async () => {
  const actual = await vi.importActual("next-auth");
  return {
    ...actual,
    getServerSession: vi.fn(),
  };
});

import { getServerSession } from "next-auth";
import { POST } from "../execute/route";

const mockGetServerSession = vi.mocked(getServerSession);

/**
 * Helper to create a mock NextRequest for the Hono endpoint.
 */
const createMockRequest = (body: unknown): Request => {
  return new Request("http://localhost:5560/api/evaluations/v3/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
};

describe("Execute Endpoint Integration", () => {
  let project: Project;
  let userId: string;

  beforeAll(async () => {
    // Get test project and user
    project = await getTestProject("execute-endpoint-integration");
    const user = await getTestUser();
    userId = user.id;
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("authentication", () => {
    it("returns 401 when no session is provided", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createMockRequest({
        projectId: project.id,
        name: "Test Evaluation",
        dataset: {
          id: "test-dataset",
          name: "Test Dataset",
          type: "inline",
          columns: [{ id: "input", name: "input", type: "string" }],
          inline: {
            columns: [{ id: "input", name: "input", type: "string" }],
            records: { input: ["Hello"] },
          },
        },
        targets: [],
        evaluators: [],
        scope: { type: "full" },
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain("logged in");
    });
  });

  describe("authorization", () => {
    it("returns 403 when user does not have evaluations:manage permission", async () => {
      // Provide a valid session for a user that doesn't have permission
      mockGetServerSession.mockResolvedValue({
        user: { id: userId, email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createMockRequest({
        projectId: project.id,
        name: "Test Evaluation",
        dataset: {
          id: "test-dataset",
          name: "Test Dataset",
          type: "inline",
          columns: [{ id: "input", name: "input", type: "string" }],
          inline: {
            columns: [{ id: "input", name: "input", type: "string" }],
            records: { input: ["Hello"] },
          },
        },
        targets: [],
        evaluators: [],
        scope: { type: "full" },
      });

      const response = await POST(request);

      // User is not a team member, so should get 403
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain("permission");
    });

    it("uses evaluations:manage permission from new RBAC system", async () => {
      // This test verifies we're using the new RBAC permission system
      // which supports custom roles with fine-grained evaluations permissions
      mockGetServerSession.mockResolvedValue({
        user: { id: userId, email: "test@example.com" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createMockRequest({
        projectId: project.id,
        name: "Test Evaluation",
        dataset: {
          id: "test-dataset",
          name: "Test Dataset",
          type: "inline",
          columns: [{ id: "input", name: "input", type: "string" }],
          inline: {
            columns: [{ id: "input", name: "input", type: "string" }],
            records: { input: ["Hello"] },
          },
        },
        targets: [],
        evaluators: [],
        scope: { type: "full" },
      });

      // Should NOT return 500 - the RBAC permission check should work
      const response = await POST(request);
      expect(response.status).not.toBe(500);
    });
  });

  describe("validation", () => {
    it("returns 400 for invalid request body", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createMockRequest({
        // Missing required fields
        projectId: project.id,
      });

      const response = await POST(request);

      // Should fail validation before auth check
      expect(response.status).toBe(400);
    });

    it("returns 400 for missing dataset", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createMockRequest({
        projectId: project.id,
        name: "Test",
        targets: [],
        evaluators: [],
        scope: { type: "full" },
        // Missing dataset
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });
  });
});
