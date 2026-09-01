/**
 * @vitest-environment jsdom
 *
 * The previous simulations screens carry a banner back to the new ones for
 * the browser that recorded the previous-screens preference.
 *
 * @see specs/suites/new-simulations-callout.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    project: { id: "project-1", slug: "demo" },
    organization: { id: "org-1" },
  })),
}));

const featureFlagState = { enabled: true };
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: vi.fn(() => ({
    enabled: featureFlagState.enabled,
    isLoading: false,
  })),
}));

// The link renders through react-router; the bare rig has no router, and
// what is under test is the address and the click side effects.
vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import posthog from "posthog-js";
import { isLegacySimulationsPreferred } from "~/hooks/useLegacySimulationsPreference";
import { ReturnToNewSimulationsBanner } from "../ReturnToNewSimulationsBanner";

const PREFERENCE_KEY = "langwatch:prefer-legacy-simulations:v1:project-1";
const SNOOZE_KEY = "langwatch:new-simulations-callout-dismissed:v1:project-1";

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

const bannerLink = () =>
  screen.getByRole("link", { name: /Go to the new simulations screen/i });

describe("<ReturnToNewSimulationsBanner />", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    featureFlagState.enabled = true;
    localStorage.setItem(PREFERENCE_KEY, "1");
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe("given the preference is recorded and the release flag is on", () => {
    /** @scenario "The previous screens carry a banner back to the new ones" */
    it("links the scenario library form to Agent Testing", () => {
      renderWithProviders(<ReturnToNewSimulationsBanner target="scenarios" />);

      expect(bannerLink().getAttribute("href")).toBe("/demo/agent-testing");
      expect(screen.getByText("Go to the new version")).toBeDefined();
    });

    /** @scenario "The previous screens carry a banner back to the new ones" */
    it("links the runs form to the Agent Testing results", () => {
      renderWithProviders(<ReturnToNewSimulationsBanner target="runs" />);

      expect(bannerLink().getAttribute("href")).toBe(
        "/demo/agent-testing/results",
      );
    });

    /** @scenario "The return banner clears the preference on click" */
    it("clears the preference and the callout dismissal on click", () => {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + 1_000_000));
      renderWithProviders(<ReturnToNewSimulationsBanner target="scenarios" />);

      fireEvent.click(bannerLink());

      expect(isLegacySimulationsPreferred("project-1")).toBe(false);
      expect(localStorage.getItem(SNOOZE_KEY)).toBeNull();
      expect(posthog.capture).toHaveBeenCalledWith(
        "new_simulations_banner_return_click",
        expect.objectContaining({ surface: "scenario_library" }),
      );
    });
  });

  describe("given the release flag is off", () => {
    /** @scenario "The return banner shows only with the release flag and the preference" */
    it("renders nothing", () => {
      featureFlagState.enabled = false;

      renderWithProviders(<ReturnToNewSimulationsBanner target="scenarios" />);

      expect(screen.queryByText("Go to the new version")).toBeNull();
    });
  });

  describe("given the preference is not recorded", () => {
    /** @scenario "The return banner shows only with the release flag and the preference" */
    it("renders nothing", () => {
      localStorage.removeItem(PREFERENCE_KEY);

      renderWithProviders(<ReturnToNewSimulationsBanner target="scenarios" />);

      expect(screen.queryByText("Go to the new version")).toBeNull();
    });
  });
});
