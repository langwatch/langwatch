import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ensureUserSyncedToCio,
  resetUserSyncCache,
  getUserSyncCacheSize,
} from "./userSync";

// Suppress logger output
vi.mock("../../../../src/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

const { mockNurturing, mockPrisma } = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    mockNurturing: {
      identifyUser: fn().mockResolvedValue(undefined),
      trackEvent: fn().mockResolvedValue(undefined),
      groupUser: fn().mockResolvedValue(undefined),
      batch: fn().mockResolvedValue(undefined),
    },
    mockPrisma: {
      user: { findUnique: fn() },
      organizationUser: { findFirst: fn() },
      organization: { findUnique: fn() },
      project: { findMany: fn() },
      subscription: { findFirst: fn() },
    },
  };
});

let currentNurturing: typeof mockNurturing | undefined = mockNurturing;

vi.mock("../../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    get nurturing() {
      return currentNurturing;
    },
  }),
}));

vi.mock("../../../../src/server/db", () => ({
  prisma: mockPrisma,
}));

describe("ensureUserSyncedToCio()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentNurturing = mockNurturing;
    resetUserSyncCache();
  });

  const setupPrismaForFullSync = () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "jane@example.com",
      name: "Jane Doe",
      createdAt: new Date("2025-01-15T10:00:00.000Z"),
    });
    mockPrisma.organizationUser.findFirst.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      role: "ADMIN",
    });
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      name: "Acme Corp",
      signupData: {
        yourRole: "engineer",
        companySize: "11-50",
      },
    });
    mockPrisma.project.findMany.mockResolvedValue([
      { id: "proj-1", firstMessage: true, integrated: true },
    ]);
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
  };

  describe("given a user who has not been synced this process lifetime", () => {
    describe("when the auth session callback fires", () => {
      it("sends full identify call with email, name, and adoption traits", async () => {
        setupPrismaForFullSync();

        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        // Wait for the async fire-and-forget to complete
        await vi.waitFor(() => {
          expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
            userId: "user-1",
            traits: expect.objectContaining({
              email: "jane@example.com",
              name: "Jane Doe",
              role: "engineer",
              company_size: "11-50",
              has_traces: true,
              createdAt: "2025-01-15T10:00:00.000Z",
            }),
          });
        });
      });

      it("sends groupUser call to associate user with organization", async () => {
        setupPrismaForFullSync();

        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        await vi.waitFor(() => {
          expect(mockNurturing.groupUser).toHaveBeenCalledWith({
            userId: "user-1",
            groupId: "org-1",
            traits: expect.objectContaining({
              name: "Acme Corp",
              company_size: "11-50",
            }),
          });
        });
      });

      it("adds userId to the sync cache", async () => {
        setupPrismaForFullSync();

        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        await vi.waitFor(() => {
          expect(getUserSyncCacheSize()).toBe(1);
        });
      });
    });
  });

  describe("given a user who has already been synced this process lifetime", () => {
    describe("when the auth session callback fires again", () => {
      it("skips the Prisma queries and CIO calls entirely", async () => {
        setupPrismaForFullSync();

        // First call: triggers full sync
        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        await vi.waitFor(() => {
          expect(mockNurturing.identifyUser).toHaveBeenCalledTimes(1);
        });

        vi.clearAllMocks();

        // Second call: should skip
        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        // Give a tick for any async work
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
        expect(mockNurturing.groupUser).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a user without an organization", () => {
    describe("when the auth session callback fires", () => {
      it("skips entirely to avoid creating ghost CIO profiles", () => {
        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: false });

        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
        expect(mockNurturing.groupUser).not.toHaveBeenCalled();
      });

      it("does not add user to the sync cache", () => {
        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: false });

        expect(getUserSyncCacheSize()).toBe(0);
      });
    });
  });

  describe("given nurturing is undefined", () => {
    describe("when the auth session callback fires", () => {
      it("silently skips without querying Prisma", () => {
        currentNurturing = undefined;

        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a Prisma query fails", () => {
    describe("when the user lookup throws", () => {
      it("does not throw (fire-and-forget)", async () => {
        const { captureException } = await import(
          "../../../../src/utils/posthogErrorCapture"
        );
        mockPrisma.user.findUnique.mockRejectedValueOnce(
          new Error("DB connection lost"),
        );

        expect(() =>
          ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true }),
        ).not.toThrow();

        await vi.waitFor(() => {
          expect(captureException).toHaveBeenCalled();
        });
      });

      it("does not add user to the sync cache so next login can retry", async () => {
        mockPrisma.user.findUnique.mockRejectedValueOnce(
          new Error("DB connection lost"),
        );

        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        await vi.waitFor(() => {
          expect(getUserSyncCacheSize()).toBe(0);
        });
      });
    });
  });

  describe("given the user has no organization membership in DB", () => {
    describe("when orgUser lookup returns null", () => {
      it("skips identify and group calls", async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: "user-1",
          email: "jane@example.com",
          name: "Jane Doe",
          createdAt: new Date("2025-01-15T10:00:00.000Z"),
        });
        mockPrisma.organizationUser.findFirst.mockResolvedValue(null);

        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        // Wait a tick for the async to resolve
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
        expect(mockNurturing.groupUser).not.toHaveBeenCalled();
      });

      it("keeps user in the sync cache (optimistic lock, cleared on restart)", async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: "user-1",
          email: "jane@example.com",
          name: "Jane Doe",
          createdAt: new Date("2025-01-15T10:00:00.000Z"),
        });
        mockPrisma.organizationUser.findFirst.mockResolvedValue(null);

        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        await new Promise((resolve) => setTimeout(resolve, 10));

        // Optimistic add keeps user cached even on no-op early return.
        // Cache is process-local, so next server restart re-syncs.
        expect(getUserSyncCacheSize()).toBe(1);
      });
    });
  });

  describe("given a user with no traces (projects without firstMessage)", () => {
    describe("when the auth session callback fires", () => {
      it("sends has_traces as false", async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: "user-1",
          email: "jane@example.com",
          name: "Jane Doe",
          createdAt: new Date("2025-01-15T10:00:00.000Z"),
        });
        mockPrisma.organizationUser.findFirst.mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
          role: "MEMBER",
        });
        mockPrisma.organization.findUnique.mockResolvedValue({
          id: "org-1",
          name: "Acme Corp",
          signupData: null,
        });
        mockPrisma.project.findMany.mockResolvedValue([
          { id: "proj-1", firstMessage: false, integrated: false },
        ]);
        mockPrisma.subscription.findFirst.mockResolvedValue(null);

        ensureUserSyncedToCio({ userId: "user-1", hasOrganization: true });

        await vi.waitFor(() => {
          expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
            userId: "user-1",
            traits: expect.objectContaining({
              has_traces: false,
            }),
          });
        });
      });
    });
  });
});
