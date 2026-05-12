import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireSubscriptionSyncNurturing } from "./subscriptionSync";

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

const mockNurturing = {
  identifyUser: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  groupUser: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn().mockResolvedValue(undefined),
};

let currentNurturing: typeof mockNurturing | undefined = mockNurturing;

vi.mock("../../../../src/server/app-layer/app", () => ({
  getApp: () => ({
    get nurturing() {
      return currentNurturing;
    },
  }),
}));

const mockFindMany = vi.fn();

vi.mock("../../../../src/server/db", () => ({
  prisma: {
    organizationUser: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

describe("Subscription sync hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentNurturing = mockNurturing;
  });

  describe("when a subscription is activated", () => {
    it("identifies all org members with has_subscription true", async () => {
      mockFindMany.mockResolvedValue([
        { userId: "user-1" },
        { userId: "user-2" },
      ]);

      fireSubscriptionSyncNurturing({
        organizationId: "org-123",
        hasSubscription: true,
      });

      await vi.waitFor(() => {
        expect(mockNurturing.identifyUser).toHaveBeenCalledTimes(2);
      });

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-1",
        traits: { has_subscription: true },
      });
      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-2",
        traits: { has_subscription: true },
      });
    });

    it("queries org members by organizationId", async () => {
      mockFindMany.mockResolvedValue([{ userId: "user-1" }]);

      fireSubscriptionSyncNurturing({
        organizationId: "org-456",
        hasSubscription: true,
      });

      await vi.waitFor(() => {
        expect(mockFindMany).toHaveBeenCalledWith({
          where: { organizationId: "org-456" },
          select: { userId: true },
        });
      });
    });
  });

  describe("when a subscription is cancelled", () => {
    it("identifies all org members with has_subscription false", async () => {
      mockFindMany.mockResolvedValue([
        { userId: "user-1" },
        { userId: "user-2" },
        { userId: "user-3" },
      ]);

      fireSubscriptionSyncNurturing({
        organizationId: "org-123",
        hasSubscription: false,
      });

      await vi.waitFor(() => {
        expect(mockNurturing.identifyUser).toHaveBeenCalledTimes(3);
      });

      expect(mockNurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-1",
        traits: { has_subscription: false },
      });
    });
  });

  describe("when the org has no members", () => {
    it("does not call identifyUser", async () => {
      mockFindMany.mockResolvedValue([]);

      fireSubscriptionSyncNurturing({
        organizationId: "org-empty",
        hasSubscription: true,
      });

      // Give the async work a chance to complete
      await vi.waitFor(() => {
        expect(mockFindMany).toHaveBeenCalled();
      });

      expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
    });
  });

  describe("when Customer.io API is unavailable", () => {
    it("does not throw (fire-and-forget)", async () => {
      const { captureException } = await import(
        "../../../../src/utils/posthogErrorCapture"
      );
      mockFindMany.mockResolvedValue([{ userId: "user-1" }]);
      mockNurturing.identifyUser.mockRejectedValueOnce(
        new Error("Customer.io error"),
      );

      expect(() =>
        fireSubscriptionSyncNurturing({
          organizationId: "org-123",
          hasSubscription: true,
        }),
      ).not.toThrow();

      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalled();
      });
    });
  });

  describe("when nurturing is undefined (no Customer.io key)", () => {
    it("silently skips without querying org members", () => {
      currentNurturing = undefined;

      fireSubscriptionSyncNurturing({
        organizationId: "org-123",
        hasSubscription: true,
      });

      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockNurturing.identifyUser).not.toHaveBeenCalled();
    });
  });
});
