/**
 * @vitest-environment node
 *
 * The fan-out behind onGuidedOnboardingEvent: who the event is attributed to
 * when the write had no user, which subscriber each event reaches, and that
 * no subscriber failure escapes to the write.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 * @see specs/nurturing/guided-onboarding-customer-io.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";
import {
  type GuidedOnboardingEventInput,
  onGuidedOnboardingEvent,
} from "../guided-onboarding.events";

const {
  trackGuidedOnboardingEvent,
  fireGuidedOnboardingPathsNurturing,
  fireGuidedOnboardingProgressNurturing,
  findFirstOrganizationUser,
  captureException,
} = vi.hoisted(() => ({
  trackGuidedOnboardingEvent: vi.fn(),
  fireGuidedOnboardingPathsNurturing: vi.fn(),
  fireGuidedOnboardingProgressNurturing: vi.fn(),
  findFirstOrganizationUser: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("../guided-onboarding.analytics", () => ({
  trackGuidedOnboardingEvent,
}));
vi.mock("~/../ee/billing/nurturing/hooks/guidedOnboarding", () => ({
  fireGuidedOnboardingPathsNurturing,
  fireGuidedOnboardingProgressNurturing,
}));
vi.mock("~/server/db", () => ({
  prisma: { organizationUser: { findFirst: findFirstOrganizationUser } },
}));
vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException,
  toError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
}));

const EMPTY: GuidedOnboardingState = { paths: [], donePaths: [] };

function input(
  overrides: Partial<GuidedOnboardingEventInput> & {
    event: GuidedOnboardingEventInput["event"];
  },
): GuidedOnboardingEventInput {
  return {
    organizationId: "org_1",
    userId: "user_1",
    payload: {},
    previous: EMPTY,
    state: EMPTY,
    ...overrides,
  };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("onGuidedOnboardingEvent()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstOrganizationUser.mockResolvedValue(null);
  });

  describe("when the write has a user", () => {
    it("reaches the analytics subscriber with that user", async () => {
      onGuidedOnboardingEvent(input({ event: "provider_skipped" }));
      await settled();

      expect(trackGuidedOnboardingEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_1",
          organizationId: "org_1",
          event: "provider_skipped",
        }),
      );
      expect(findFirstOrganizationUser).not.toHaveBeenCalled();
    });

    it("routes the paths events to the paths nurturing hook with the previous paths", async () => {
      onGuidedOnboardingEvent(
        input({
          event: "path_begun",
          payload: { path: "governance" },
          previous: { paths: ["llmops"], donePaths: [] },
          state: {
            paths: ["llmops", "governance"],
            donePaths: [],
            currentPath: "governance",
          },
        }),
      );
      await settled();

      expect(fireGuidedOnboardingPathsNurturing).toHaveBeenCalledWith({
        userId: "user_1",
        organizationId: "org_1",
        event: "path_begun",
        previousPaths: ["llmops"],
        paths: ["llmops", "governance"],
      });
      expect(fireGuidedOnboardingProgressNurturing).not.toHaveBeenCalled();
    });

    it("routes the progress events to the progress nurturing hook", async () => {
      const state: GuidedOnboardingState = {
        paths: ["gateway"],
        donePaths: ["gateway"],
      };
      onGuidedOnboardingEvent(
        input({ event: "path_completed", payload: { path: "gateway" }, state }),
      );
      await settled();

      expect(fireGuidedOnboardingProgressNurturing).toHaveBeenCalledWith({
        userId: "user_1",
        organizationId: "org_1",
        event: "path_completed",
        payload: { path: "gateway" },
        state,
      });
      expect(fireGuidedOnboardingPathsNurturing).not.toHaveBeenCalled();
    });

    it("sends the events with nothing for nurturing to the analytics subscriber only", async () => {
      onGuidedOnboardingEvent(input({ event: "tour_replayed" }));
      onGuidedOnboardingEvent(
        input({
          event: "conversation_attached",
          payload: { conversationId: "conv_1" },
        }),
      );
      await settled();

      expect(trackGuidedOnboardingEvent).toHaveBeenCalledTimes(2);
      expect(fireGuidedOnboardingPathsNurturing).not.toHaveBeenCalled();
      expect(fireGuidedOnboardingProgressNurturing).not.toHaveBeenCalled();
    });
  });

  describe("when the write came through a project credential with no user", () => {
    /** @scenario "a write through a project credential is tracked against the organization admin" */
    /** @scenario "a write through a project credential is attributed to the organization admin" */
    it("attributes the event to the organization's first admin", async () => {
      findFirstOrganizationUser.mockResolvedValue({ userId: "admin_1" });

      onGuidedOnboardingEvent(
        input({
          event: "path_completed",
          userId: undefined,
          payload: { path: "llmops" },
          state: { paths: ["llmops"], donePaths: ["llmops"] },
        }),
      );
      await settled();

      expect(findFirstOrganizationUser).toHaveBeenCalledWith({
        where: { organizationId: "org_1", role: "ADMIN" },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      });
      expect(trackGuidedOnboardingEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "admin_1" }),
      );
      expect(fireGuidedOnboardingProgressNurturing).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "admin_1" }),
      );
    });

    /** @scenario "a write through a project credential of an organization without an admin tracks nothing" */
    it("tracks nothing when the organization has no admin", async () => {
      onGuidedOnboardingEvent(
        input({ event: "path_completed", userId: undefined }),
      );
      await settled();

      expect(trackGuidedOnboardingEvent).not.toHaveBeenCalled();
      expect(fireGuidedOnboardingProgressNurturing).not.toHaveBeenCalled();
    });
  });

  describe("when a subscriber throws", () => {
    /** @scenario "a failing analytics call never fails the write" */
    it("returns normally, captures the failure and still reaches the other subscriber", async () => {
      trackGuidedOnboardingEvent.mockImplementation(() => {
        throw new Error("posthog down");
      });

      expect(() =>
        onGuidedOnboardingEvent(
          input({
            event: "paths_selected",
            state: { paths: ["llmops"], donePaths: [], currentPath: "llmops" },
          }),
        ),
      ).not.toThrow();
      await settled();

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "posthog down" }),
      );
      expect(fireGuidedOnboardingPathsNurturing).toHaveBeenCalledTimes(1);
    });

    /** @scenario "a Customer.io failure never fails the write" */
    it("captures a nurturing failure without failing the write", async () => {
      fireGuidedOnboardingPathsNurturing.mockImplementation(() => {
        throw new Error("customer.io down");
      });

      expect(() =>
        onGuidedOnboardingEvent(
          input({
            event: "paths_selected",
            state: { paths: ["llmops"], donePaths: [], currentPath: "llmops" },
          }),
        ),
      ).not.toThrow();
      await settled();

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "customer.io down" }),
      );
      expect(trackGuidedOnboardingEvent).toHaveBeenCalledTimes(1);
    });

    it("captures a failed admin lookup without failing the write", async () => {
      findFirstOrganizationUser.mockRejectedValue(new Error("db down"));

      expect(() =>
        onGuidedOnboardingEvent(
          input({ event: "path_completed", userId: undefined }),
        ),
      ).not.toThrow();
      await settled();

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "db down" }),
      );
    });
  });
});
