/**
 * @vitest-environment jsdom
 *
 * Unit tests for usePostHogIdentify hook.
 *
 * Verifies:
 * - Calls posthog.identify with userId and email
 * - Calls posthog.group with organization data
 * - Calls posthog.reset on logout (userId disappears)
 * - Tracks upgrade_modal_shown via Zustand subscribe
 * - Suppresses all PostHog capturing during impersonation
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const {
  mockIdentify,
  mockGroup,
  mockReset,
  mockCapture,
  mockOptOutCapturing,
  mockOptInCapturing,
} = vi.hoisted(() => ({
  mockIdentify: vi.fn(),
  mockGroup: vi.fn(),
  mockReset: vi.fn(),
  mockCapture: vi.fn(),
  mockOptOutCapturing: vi.fn(),
  mockOptInCapturing: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    identify: mockIdentify,
    group: mockGroup,
    reset: mockReset,
    capture: mockCapture,
    opt_out_capturing: mockOptOutCapturing,
    opt_in_capturing: mockOptInCapturing,
  },
}));

import { useUpgradeModalStore } from "../../stores/upgradeModalStore";
import { usePostHogIdentify } from "../usePostHogIdentify";

describe("usePostHogIdentify", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useUpgradeModalStore.getState().close();
  });

  afterEach(() => {
    useUpgradeModalStore.getState().close();
  });

  describe("when session has a user", () => {
    it("identifies user with userId and email", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1", email: "test@example.com" } },
          organization: undefined,
          planType: undefined,
        }),
      );

      expect(mockIdentify).toHaveBeenCalledWith("user-1", {
        email: "test@example.com",
      });
    });

    it("identifies user without email when not provided", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1", email: null } },
          organization: undefined,
          planType: undefined,
        }),
      );

      expect(mockIdentify).toHaveBeenCalledWith("user-1", {
        email: undefined,
      });
    });
  });

  describe("when session is null", () => {
    it("does not call identify", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: null,
          organization: undefined,
          planType: undefined,
        }),
      );

      expect(mockIdentify).not.toHaveBeenCalled();
    });
  });

  describe("when user logs out", () => {
    it("calls posthog.reset", () => {
      const { rerender } = renderHook(
        ({
          session,
        }: {
          session: { user: { id: string; email?: string | null } } | null;
        }) =>
          usePostHogIdentify({
            session,
            organization: undefined,
            planType: undefined,
          }),
        {
          initialProps: {
            session: {
              user: { id: "user-1", email: "test@example.com" },
            } as { user: { id: string; email?: string | null } } | null,
          },
        },
      );

      expect(mockIdentify).toHaveBeenCalledTimes(1);

      // Simulate logout
      rerender({ session: null });

      expect(mockReset).toHaveBeenCalledTimes(1);
    });
  });

  describe("when user switches from A to B", () => {
    it("calls posthog.reset before identifying new user", () => {
      const { rerender } = renderHook(
        ({
          session,
        }: {
          session: { user: { id: string; email?: string | null } } | null;
        }) =>
          usePostHogIdentify({
            session,
            organization: undefined,
            planType: undefined,
          }),
        {
          initialProps: {
            session: {
              user: { id: "user-1", email: "a@example.com" },
            } as { user: { id: string; email?: string | null } } | null,
          },
        },
      );

      expect(mockIdentify).toHaveBeenCalledWith("user-1", {
        email: "a@example.com",
      });

      // Switch to different user
      rerender({
        session: { user: { id: "user-2", email: "b@example.com" } },
      });

      expect(mockReset).toHaveBeenCalledTimes(1);
      expect(mockIdentify).toHaveBeenCalledWith("user-2", {
        email: "b@example.com",
      });
    });
  });

  describe("when organization is provided", () => {
    it("groups by organization with name and planType", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1" } },
          organization: { id: "org-1", name: "Acme Corp" },
          planType: "pro",
        }),
      );

      expect(mockGroup).toHaveBeenCalledWith("organization", "org-1", {
        name: "Acme Corp",
        planType: "pro",
      });
    });

    it("omits planType when not provided", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1" } },
          organization: { id: "org-1", name: "Acme Corp" },
          planType: undefined,
        }),
      );

      expect(mockGroup).toHaveBeenCalledWith("organization", "org-1", {
        name: "Acme Corp",
      });
    });
  });

  describe("when organization is undefined", () => {
    it("does not call group", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1" } },
          organization: undefined,
          planType: undefined,
        }),
      );

      expect(mockGroup).not.toHaveBeenCalled();
    });
  });

  describe("when organization is provided but session is null", () => {
    it("does not call group", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: null,
          organization: { id: "org-1", name: "Acme Corp" },
          planType: "pro",
        }),
      );

      expect(mockGroup).not.toHaveBeenCalled();
    });
  });

  describe("when upgrade modal opens", () => {
    it("captures upgrade_modal_shown with limit details", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1" } },
          organization: undefined,
          planType: undefined,
        }),
      );

      // Open upgrade modal
      useUpgradeModalStore.getState().open("workflows", 5, 5);

      expect(mockCapture).toHaveBeenCalledWith("upgrade_modal_shown", {
        mode: "limit",
        limitType: "workflows",
        current: 5,
        max: 5,
      });
    });

    it("captures upgrade_modal_shown for seats variant", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1" } },
          organization: undefined,
          planType: undefined,
        }),
      );

      useUpgradeModalStore.getState().openSeats({
        organizationId: "org-1",
        currentSeats: 3,
        newSeats: 5,
        onConfirm: vi.fn(),
      });

      expect(mockCapture).toHaveBeenCalledWith("upgrade_modal_shown", {
        mode: "seats",
      });
    });

    it("captures upgrade_modal_shown for liteMemberRestriction variant", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1" } },
          organization: undefined,
          planType: undefined,
        }),
      );

      useUpgradeModalStore
        .getState()
        .openLiteMemberRestriction({ resource: "prompts" });

      expect(mockCapture).toHaveBeenCalledWith("upgrade_modal_shown", {
        mode: "liteMemberRestriction",
      });
    });

    it("does not fire when modal closes", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1" } },
          organization: undefined,
          planType: undefined,
        }),
      );

      useUpgradeModalStore.getState().open("workflows", 5, 5);
      mockCapture.mockClear();

      useUpgradeModalStore.getState().close();

      expect(mockCapture).not.toHaveBeenCalled();
    });

    it("does not capture during impersonation", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: {
            user: {
              id: "user-1",
              impersonator: { email: "admin@example.com" },
            },
          },
          organization: undefined,
          planType: undefined,
        }),
      );

      useUpgradeModalStore.getState().open("workflows", 5, 5);

      expect(mockCapture).not.toHaveBeenCalled();
    });
  });

  describe("when session has an impersonator", () => {
    it("opts out of PostHog capturing", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: {
            user: {
              id: "user-1",
              email: "impersonated@example.com",
              impersonator: { email: "admin@example.com" },
            },
          },
          organization: { id: "org-1", name: "Acme Corp" },
          planType: "pro",
        }),
      );

      expect(mockOptOutCapturing).toHaveBeenCalled();
    });

    it("does not call identify", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: {
            user: {
              id: "user-1",
              impersonator: { email: "admin@example.com" },
            },
          },
          organization: undefined,
          planType: undefined,
        }),
      );

      expect(mockIdentify).not.toHaveBeenCalled();
    });

    it("does not call group", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: {
            user: {
              id: "user-1",
              impersonator: { email: "admin@example.com" },
            },
          },
          organization: { id: "org-1", name: "Acme Corp" },
          planType: "pro",
        }),
      );

      expect(mockGroup).not.toHaveBeenCalled();
    });
  });

  describe("when session has no impersonator", () => {
    it("opts in to PostHog capturing", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: { user: { id: "user-1", email: "test@example.com" } },
          organization: undefined,
          planType: undefined,
        }),
      );

      expect(mockOptInCapturing).toHaveBeenCalled();
    });
  });

  describe("when impersonation ends", () => {
    it("re-enables capturing and re-identifies user", () => {
      type SessionType = {
        user: {
          id: string;
          email?: string | null;
          impersonator?: { email?: string | null };
        };
      } | null;

      const { rerender } = renderHook(
        ({ session }: { session: SessionType }) =>
          usePostHogIdentify({
            session,
            organization: undefined,
            planType: undefined,
          }),
        {
          initialProps: {
            session: {
              user: {
                id: "user-1",
                email: "impersonated@example.com",
                impersonator: { email: "admin@example.com" },
              },
            } as SessionType,
          },
        },
      );

      expect(mockOptOutCapturing).toHaveBeenCalled();
      expect(mockIdentify).not.toHaveBeenCalled();

      vi.clearAllMocks();

      // Transition to normal session (impersonation ends)
      rerender({
        session: {
          user: { id: "real-user", email: "real@example.com" },
        },
      });

      expect(mockOptInCapturing).toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalled();
      expect(mockIdentify).toHaveBeenCalledWith("real-user", {
        email: "real@example.com",
      });
    });
  });
});
