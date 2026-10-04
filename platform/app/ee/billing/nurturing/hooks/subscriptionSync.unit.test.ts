import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireSubscriptionStartedAnalytics,
  fireSubscriptionSyncNurturing,
} from "./subscriptionSync";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

const mockNurturing = {
  identifyUser: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  groupUser: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn().mockResolvedValue(undefined),
};

let currentNurturing: typeof mockNurturing | undefined = mockNurturing;

vi.mock("../../../../src/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
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

const { mockTrackServerEvent, mockGetPostHogInstance } = vi.hoisted(() => ({
  mockTrackServerEvent: vi.fn(),
  mockGetPostHogInstance: vi.fn(),
}));

vi.mock("../../../../src/server/posthog", () => ({
  trackServerEvent: mockTrackServerEvent,
  getPostHogInstance: mockGetPostHogInstance,
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

describe("Subscription started analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPostHogInstance.mockReturnValue({});
  });

  describe("when a subscription becomes active", () => {
    /** @scenario "A started subscription tracks subscription_started for every organization member" */
    it("tracks subscription_started for each organization member", async () => {
      mockFindMany.mockResolvedValue([
        { userId: "user-1" },
        { userId: "user-2" },
      ]);

      fireSubscriptionStartedAnalytics({
        organizationId: "org-123",
        plan: "GROWTH_SEAT_EUR_MONTHLY",
      });

      await vi.waitFor(() => {
        expect(mockTrackServerEvent).toHaveBeenCalledTimes(2);
      });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { organizationId: "org-123" },
        select: { userId: true },
      });
      for (const userId of ["user-1", "user-2"]) {
        expect(mockTrackServerEvent).toHaveBeenCalledWith({
          userId,
          event: "subscription_started",
          properties: {
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            organization_id: "org-123",
            $groups: { organization: "org-123" },
          },
        });
      }
    });
  });

  describe("when PostHog is not configured", () => {
    /** @scenario "subscription_started is skipped when PostHog is not configured" */
    it("does not query members or track", async () => {
      mockGetPostHogInstance.mockReturnValue(null);

      fireSubscriptionStartedAnalytics({
        organizationId: "org-123",
        plan: "LAUNCH",
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockTrackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the member lookup fails", () => {
    /** @scenario "A failed member lookup does not break the webhook" */
    it("captures the error and does not throw", async () => {
      const { captureException } = await import(
        "../../../../src/utils/posthogErrorCapture"
      );
      const error = new Error("db unavailable");
      mockFindMany.mockRejectedValue(error);

      expect(() =>
        fireSubscriptionStartedAnalytics({
          organizationId: "org-123",
          plan: "LAUNCH",
        }),
      ).not.toThrow();

      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalledWith(error);
      });
      expect(mockTrackServerEvent).not.toHaveBeenCalled();
    });
  });
});
