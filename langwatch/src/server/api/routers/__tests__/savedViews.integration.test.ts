/**
 * @vitest-environment node
 *
 * Integration tests for SavedViews tRPC endpoints.
 * Tests the actual CRUD operations through the tRPC layer.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Mock license enforcement to avoid limits during tests
vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return {
    ...actual,
    enforceLicenseLimit: vi.fn(),
  };
});

describe("SavedViews Endpoints", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;
  let userId: string;

  beforeAll(async () => {
    // Clean up any existing test saved views before running tests
    await prisma.savedView.deleteMany({
      where: { projectId },
    });

    const user = await getTestUser();
    userId = user.id;
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    await prisma.savedView.deleteMany({
      where: { projectId },
    });
  });

  describe("getAll", () => {
    beforeAll(async () => {
      // Clean slate for getAll tests
      await prisma.savedView.deleteMany({ where: { projectId } });
    });

    it("seeds views on first access for a project", async () => {
      const result = await caller.savedViews.getAll({ projectId });

      expect(result).toHaveLength(4);
      expect(result.map((v) => v.name)).toEqual([
        "Application",
        "Evaluations",
        "Simulations",
        "Playground",
      ]);
    });

    it("returns views ordered by order field", async () => {
      const result = await caller.savedViews.getAll({ projectId });

      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.order).toBeGreaterThanOrEqual(result[i - 1]!.order);
      }
    });

    it("does not re-seed if views already exist", async () => {
      const first = await caller.savedViews.getAll({ projectId });
      const second = await caller.savedViews.getAll({ projectId });

      expect(second).toHaveLength(first.length);
      // Same IDs means no re-seeding happened
      expect(second.map((v) => v.id)).toEqual(first.map((v) => v.id));
    });
  });

  describe("create", () => {
    it("adds a view with correct data and order", async () => {
      const result = await caller.savedViews.create({
        projectId,
        name: "Custom View",
        filters: { "spans.model": ["gpt-4"] },
        query: "error timeout",
        period: { relativeDays: 7 },
      });

      expect(result.name).toBe("Custom View");
      expect(result.filters).toEqual({ "spans.model": ["gpt-4"] });
      expect(result.query).toBe("error timeout");
      expect(result.period).toEqual({ relativeDays: 7 });
      expect(result.projectId).toBe(projectId);
    });

    it("sets order after last existing view", async () => {
      const before = await caller.savedViews.getAll({ projectId });
      const lastOrder = Math.max(...before.map((v) => v.order));

      const result = await caller.savedViews.create({
        projectId,
        name: "Another View",
        filters: { "traces.error": ["true"] },
      });

      expect(result.order).toBe(lastOrder + 1);
    });
  });

  describe("delete", () => {
    it("removes a view", async () => {
      const created = await caller.savedViews.create({
        projectId,
        name: "To Delete",
        filters: {},
      });

      await caller.savedViews.delete({
        projectId,
        viewId: created.id,
      });

      const all = await caller.savedViews.getAll({ projectId });
      const found = all.find((v) => v.id === created.id);
      expect(found).toBeUndefined();
    });

    it("throws NOT_FOUND for non-existent view", async () => {
      await expect(
        caller.savedViews.delete({
          projectId,
          viewId: "non-existent-id",
        }),
      ).rejects.toThrow(/not found/i);
    });

    it("throws NOT_FOUND for view from different project (multitenancy)", async () => {
      const created = await caller.savedViews.create({
        projectId,
        name: "Multitenancy Test",
        filters: {},
      });

      await expect(
        caller.savedViews.delete({
          projectId: "different-project-id",
          viewId: created.id,
        }),
      ).rejects.toThrow();

      // Clean up
      await caller.savedViews.delete({
        projectId,
        viewId: created.id,
      });
    });
  });

  describe("rename", () => {
    it("updates the view name", async () => {
      const created = await caller.savedViews.create({
        projectId,
        name: "Old Name",
        filters: {},
      });

      const updated = await caller.savedViews.rename({
        projectId,
        viewId: created.id,
        name: "New Name",
      });

      expect(updated.name).toBe("New Name");
      expect(updated.id).toBe(created.id);

      // Clean up
      await caller.savedViews.delete({ projectId, viewId: created.id });
    });

    it("throws NOT_FOUND for non-existent view", async () => {
      await expect(
        caller.savedViews.rename({
          projectId,
          viewId: "non-existent-id",
          name: "New Name",
        }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("reorder", () => {
    it("updates order for all views", async () => {
      // Clean slate
      await prisma.savedView.deleteMany({ where: { projectId } });

      const viewA = await caller.savedViews.create({
        projectId,
        name: "View A",
        filters: {},
      });
      const viewB = await caller.savedViews.create({
        projectId,
        name: "View B",
        filters: {},
      });
      const viewC = await caller.savedViews.create({
        projectId,
        name: "View C",
        filters: {},
      });

      // Reorder: C, A, B
      await caller.savedViews.reorder({
        projectId,
        viewIds: [viewC.id, viewA.id, viewB.id],
      });

      const result = await caller.savedViews.getAll({ projectId });
      expect(result.map((v) => v.name)).toEqual([
        "View C",
        "View A",
        "View B",
      ]);
    });

    it("throws NOT_FOUND if any view ID does not belong to project", async () => {
      await expect(
        caller.savedViews.reorder({
          projectId,
          viewIds: ["non-existent-view-id"],
        }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("scope (personal vs project views)", () => {
    beforeAll(async () => {
      // Clean slate for scope tests
      await prisma.savedView.deleteMany({ where: { projectId } });
    });

    it("stores userId as null when scope is 'project'", async () => {
      const result = await caller.savedViews.create({
        projectId,
        name: "Project View",
        filters: {},
        scope: "project",
      });

      expect(result.userId).toBeNull();
    });

    it("stores the current user's ID when scope is 'myself'", async () => {
      const result = await caller.savedViews.create({
        projectId,
        name: "My Personal View",
        filters: { "spans.model": ["gpt-4"] },
        scope: "myself",
      });

      expect(result.userId).toBe(userId);
    });

    it("defaults scope to 'project' when not specified", async () => {
      const result = await caller.savedViews.create({
        projectId,
        name: "Default Scope View",
        filters: {},
      });

      expect(result.userId).toBeNull();
    });

    it("returns both project and personal views for the current user", async () => {
      const result = await caller.savedViews.getAll({ projectId });

      const projectViews = result.filter((v) => v.userId === null);
      const personalViews = result.filter((v) => v.userId === userId);

      expect(projectViews.length).toBeGreaterThanOrEqual(1);
      expect(personalViews.length).toBeGreaterThanOrEqual(1);
    });

    it("does not return another user's personal views", async () => {
      // Create a real user so the foreign key constraint is satisfied
      const otherUser = await prisma.user.upsert({
        where: { email: "other-test-user@example.com" },
        update: {},
        create: {
          name: "Other Test User",
          email: "other-test-user@example.com",
        },
      });

      await prisma.savedView.create({
        data: {
          projectId,
          userId: otherUser.id,
          name: "Other User's View",
          filters: {},
          order: 999,
        },
      });

      const result = await caller.savedViews.getAll({ projectId });

      const otherUserViews = result.filter(
        (v) => v.userId === otherUser.id,
      );
      expect(otherUserViews).toHaveLength(0);
    });
  });
});
