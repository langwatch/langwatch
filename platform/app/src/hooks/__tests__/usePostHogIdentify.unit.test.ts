/**
 * @vitest-environment jsdom
 *
 * Unit tests for usePostHogIdentify hook.
 *
 * Verifies:
 * - Calls posthog.identify with userId and email
 * - Calls posthog.group with organization data
 * - Calls posthog.reset on logout (userId disappears)
 * - Captures signed_in once per browser session with attribution
 * - Tracks upgrade_modal_shown via Zustand subscribe
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIdentify, mockGroup, mockReset, mockCapture } = vi.hoisted(() => ({
  mockIdentify: vi.fn(),
  mockGroup: vi.fn(),
  mockReset: vi.fn(),
  mockCapture: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    identify: mockIdentify,
    group: mockGroup,
    reset: mockReset,
    capture: mockCapture,
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

import { useUpgradeModalStore } from "../../stores/upgradeModalStore";
import {
  resetSignedInTracking,
  usePostHogIdentify,
} from "../usePostHogIdentify";

function setUrl(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

function signedInCalls() {
  return mockCapture.mock.calls.filter(([event]) => event === "signed_in");
}

function renderIdentified(userId = "user-1") {
  return renderHook(() =>
    usePostHogIdentify({
      session: { user: { id: userId, email: "test@example.com" } },
      organization: undefined,
      planType: undefined,
    }),
  );
}

describe("usePostHogIdentify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpgradeModalStore.getState().close();
    window.sessionStorage.clear();
    resetSignedInTracking();
    setUrl("");
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

  describe("when an identified user loads the app", () => {
    /** @scenario "An identified user loading the app tracks signed_in with stored attribution" */
    it("captures signed_in with the stored first-touch attribution", () => {
      window.sessionStorage.setItem("lw_attrib.utmSource", "newsletter");
      window.sessionStorage.setItem("lw_attrib.utmCampaign", "weekly");
      window.sessionStorage.setItem("lw_attrib.leadSource", "website");
      window.sessionStorage.setItem("lw_attrib.referrer", "https://x.test/");

      renderIdentified();

      expect(signedInCalls()).toEqual([
        [
          "signed_in",
          {
            lead_source: "website",
            utm_source: "newsletter",
            utm_campaign: "weekly",
            referrer: "https://x.test/",
          },
        ],
      ]);
    });

    /** @scenario "UTM params on the current URL are reported on signed_in" */
    it("reports only the campaign of the current URL when it has one", () => {
      window.sessionStorage.setItem("lw_attrib.utmSource", "google");
      window.sessionStorage.setItem("lw_attrib.utmMedium", "cpc");
      setUrl("?utm_source=newsletter&utm_content=cta");

      renderIdentified();

      expect(signedInCalls()).toEqual([
        ["signed_in", { utm_source: "newsletter", utm_content: "cta" }],
      ]);
    });

    /** @scenario "signed_in without any attribution carries no attribution properties" */
    it("captures signed_in with no properties when nothing is known", () => {
      renderIdentified();

      expect(signedInCalls()).toEqual([["signed_in", {}]]);
    });

    it("captures signed_in after identifying the user", () => {
      renderIdentified();

      expect(mockIdentify.mock.invocationCallOrder[0]!).toBeLessThan(
        mockCapture.mock.invocationCallOrder[0]!,
      );
    });

    /** @scenario "signed_in is captured once per browser session" */
    it("captures signed_in once across remounts and page loads of a session", () => {
      renderIdentified().unmount();
      renderIdentified().unmount();
      // A new page load loses module state and keeps sessionStorage.
      resetSignedInTracking();
      renderIdentified();

      expect(signedInCalls()).toHaveLength(1);
    });

    it("captures signed_in again in a new browser session", () => {
      renderIdentified().unmount();
      window.sessionStorage.clear();
      resetSignedInTracking();
      renderIdentified();

      expect(signedInCalls()).toHaveLength(2);
    });

    /** @scenario "A different user signing in on the same tab tracks signed_in again" */
    it("captures signed_in for a second user on the same tab", () => {
      const { rerender } = renderHook(
        ({ userId }: { userId: string }) =>
          usePostHogIdentify({
            session: { user: { id: userId } },
            organization: undefined,
            planType: undefined,
          }),
        { initialProps: { userId: "user-1" } },
      );

      rerender({ userId: "user-2" });

      expect(signedInCalls()).toHaveLength(2);
    });

    /** @scenario "A user who already signed in on the tab is not counted again after another user" */
    it("does not capture signed_in again for the first user after a reload", () => {
      renderIdentified("user-1").unmount();
      renderIdentified("user-2").unmount();
      resetSignedInTracking();
      renderIdentified("user-1");

      expect(signedInCalls()).toHaveLength(2);
    });

    describe("when sessionStorage is unavailable", () => {
      it("captures signed_in once per page load", () => {
        const getItem = vi
          .spyOn(Storage.prototype, "getItem")
          .mockImplementation(() => {
            throw new Error("storage disabled");
          });
        const setItem = vi
          .spyOn(Storage.prototype, "setItem")
          .mockImplementation(() => {
            throw new Error("storage disabled");
          });

        try {
          renderIdentified().unmount();
          renderIdentified();

          expect(signedInCalls()).toHaveLength(1);
        } finally {
          getItem.mockRestore();
          setItem.mockRestore();
        }
      });
    });
  });

  describe("when session is null", () => {
    /** @scenario "Anonymous visitors track no signed_in event" */
    it("does not capture signed_in", () => {
      setUrl("?utm_source=newsletter");

      renderHook(() =>
        usePostHogIdentify({
          session: null,
          organization: undefined,
          planType: undefined,
        }),
      );

      expect(signedInCalls()).toHaveLength(0);
    });

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
      useUpgradeModalStore.getState().open("members", 5, 5);

      expect(mockCapture).toHaveBeenCalledWith("upgrade_modal_shown", {
        mode: "limit",
        limitType: "members",
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

      useUpgradeModalStore.getState().open("members", 5, 5);
      mockCapture.mockClear();

      useUpgradeModalStore.getState().close();

      expect(mockCapture).not.toHaveBeenCalled();
    });
  });
});
