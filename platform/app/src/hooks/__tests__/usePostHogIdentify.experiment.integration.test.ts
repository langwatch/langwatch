/**
 * @vitest-environment jsdom
 *
 * The browser side of the onboarding experiment: once the signed-in user's
 * organization is known, its recorded variant is registered with posthog-js
 * so every client event carries the experiment property.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRegister, mockUnregister } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockUnregister: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    identify: vi.fn(),
    group: vi.fn(),
    reset: vi.fn(),
    capture: vi.fn(),
    register: mockRegister,
    unregister: mockUnregister,
  },
}));

import { usePostHogIdentify } from "../usePostHogIdentify";

const session = { user: { id: "user-1", email: "user@example.com" } };

describe("usePostHogIdentify() and the onboarding experiment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the organization recorded the guided variant", () => {
    /** @scenario "the browser registers the experiment property once the organization's variant is known" */
    it("registers the experiment property with the variant guided", () => {
      renderHook(() =>
        usePostHogIdentify({
          session,
          organization: {
            id: "org-1",
            name: "ACME",
            signupData: { onboardingVariant: "guided" },
          },
          planType: undefined,
        }),
      );

      expect(mockRegister).toHaveBeenCalledWith({
        "$feature/experiment_onboarding_langy_guided": "guided",
      });
    });

    it("registers control for the classic variant", () => {
      renderHook(() =>
        usePostHogIdentify({
          session,
          organization: {
            id: "org-1",
            name: "ACME",
            signupData: { onboardingVariant: "classic" },
          },
          planType: undefined,
        }),
      );

      expect(mockRegister).toHaveBeenCalledWith({
        "$feature/experiment_onboarding_langy_guided": "control",
      });
    });
  });

  describe("when the organization predates the experiment", () => {
    /** @scenario "the browser registers nothing for an organization without a variant" */
    it("registers no experiment property and clears any registered one", () => {
      renderHook(() =>
        usePostHogIdentify({
          session,
          organization: {
            id: "org-1",
            name: "ACME",
            signupData: { companyType: "company" },
          },
          planType: undefined,
        }),
      );

      expect(mockRegister).not.toHaveBeenCalled();
      expect(mockUnregister).toHaveBeenCalledWith(
        "$feature/experiment_onboarding_langy_guided",
      );
    });

    it("clears the property when the user switches from an organization with a variant", () => {
      const { rerender } = renderHook(
        ({ organization }) =>
          usePostHogIdentify({ session, organization, planType: undefined }),
        {
          initialProps: {
            organization: {
              id: "org-1",
              name: "ACME",
              signupData: { onboardingVariant: "guided" } as unknown,
            },
          },
        },
      );
      expect(mockRegister).toHaveBeenCalledWith({
        "$feature/experiment_onboarding_langy_guided": "guided",
      });
      expect(mockUnregister).not.toHaveBeenCalled();

      rerender({
        organization: {
          id: "org-2",
          name: "ACME Legacy",
          signupData: { companyType: "company" },
        },
      });

      expect(mockUnregister).toHaveBeenCalledWith(
        "$feature/experiment_onboarding_langy_guided",
      );
    });
  });

  describe("when no user is signed in", () => {
    it("registers nothing", () => {
      renderHook(() =>
        usePostHogIdentify({
          session: null,
          organization: {
            id: "org-1",
            name: "ACME",
            signupData: { onboardingVariant: "guided" },
          },
          planType: undefined,
        }),
      );

      expect(mockRegister).not.toHaveBeenCalled();
    });
  });
});
