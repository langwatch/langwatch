/**
 * What a started subscription reports to PostHog, and to whom.
 *
 * @see specs/analytics/posthog-campaign-conversion.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireSubscriptionStartedAnalytics } from "../subscriptionStarted.analytics";

vi.mock("../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

const { mockTrackServerEvent, mockGetPostHogInstance, mockFindMany } =
  vi.hoisted(() => ({
    mockTrackServerEvent: vi.fn(),
    mockGetPostHogInstance: vi.fn(),
    mockFindMany: vi.fn(),
  }));

vi.mock("../../../src/server/posthog", () => ({
  trackServerEvent: mockTrackServerEvent,
  getPostHogInstance: mockGetPostHogInstance,
}));

vi.mock("../../../src/server/db", () => ({
  prisma: {
    organizationUser: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

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
        "../../../src/utils/posthogErrorCapture"
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

  describe("when the PostHog client cannot be built", () => {
    /** @scenario "A PostHog client that cannot be built does not break the webhook" */
    it("captures the error and does not throw", async () => {
      const { captureException } = await import(
        "../../../src/utils/posthogErrorCapture"
      );
      const error = new Error("bad PostHog configuration");
      mockGetPostHogInstance.mockImplementation(() => {
        throw error;
      });

      expect(() =>
        fireSubscriptionStartedAnalytics({
          organizationId: "org-123",
          plan: "LAUNCH",
        }),
      ).not.toThrow();

      expect(captureException).toHaveBeenCalledWith(error);
      expect(mockFindMany).not.toHaveBeenCalled();
    });
  });
});
