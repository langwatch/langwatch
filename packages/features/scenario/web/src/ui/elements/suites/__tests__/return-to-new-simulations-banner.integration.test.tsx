/**
 * @vitest-environment jsdom
 *
 * The previous simulations screens carry a banner back to the new ones for
 * the browser that recorded the previous-screens preference.
 *
 * @see specs/suites/new-simulations-callout.feature
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    project: { id: "project-1", slug: "demo" },
    organization: { id: "org-1" },
  })),
}));

const featureFlagState = { enabled: true };
vi.mock("../../../../behavior/use-feature-flag", () => ({
  useFeatureFlag: vi.fn(() => ({
    enabled: featureFlagState.enabled,
    isLoading: false,
  })),
}));

import posthog from "posthog-js";
import { isLegacySimulationsPreferred } from "../../../../behavior/suites/use-legacy-simulations-preference";
import { ReturnToNewSimulationsBanner } from "../return-to-new-simulations-banner";

const PREFERENCE_KEY = "langwatch:prefer-legacy-simulations:v1:project-1";
const SNOOZE_KEY = "langwatch:new-simulations-callout-dismissed:v1:project-1";

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

const bannerLink = () => screen.getByRole("link", { name: /Go to the new simulations screen/i });

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
    describe("when the scenario library form renders", () => {
      /** @scenario "The previous screens carry a banner back to the new ones" */
      it("links to Agent Testing", () => {
        renderWithProviders(<ReturnToNewSimulationsBanner target="scenarios" />);

        expect(bannerLink().getAttribute("href")).toBe("/demo/agent-testing");
        expect(screen.getByText("Go to the new version")).toBeDefined();
      });
    });

    describe("when the runs form renders", () => {
      /** @scenario "The previous screens carry a banner back to the new ones" */
      it("links to the Agent Testing results", () => {
        renderWithProviders(<ReturnToNewSimulationsBanner target="runs" />);

        expect(bannerLink().getAttribute("href")).toBe("/demo/agent-testing/results");
      });
    });

    describe("when the person clicks the banner", () => {
      /** @scenario "The return banner clears the preference on click" */
      it("clears the preference and the callout dismissal", () => {
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
  });

  describe("given the release flag is off", () => {
    describe("when the previous screens render", () => {
      /** @scenario "The return banner shows only with the release flag and the preference" */
      it("renders nothing", () => {
        featureFlagState.enabled = false;

        renderWithProviders(<ReturnToNewSimulationsBanner target="scenarios" />);

        expect(screen.queryByText("Go to the new version")).toBeNull();
      });
    });
  });

  describe("given the preference is not recorded", () => {
    describe("when the previous screens render", () => {
      /** @scenario "The return banner shows only with the release flag and the preference" */
      it("renders nothing", () => {
        localStorage.removeItem(PREFERENCE_KEY);

        renderWithProviders(<ReturnToNewSimulationsBanner target="scenarios" />);

        expect(screen.queryByText("Go to the new version")).toBeNull();
      });
    });
  });

  // The scenario is about the previous SCREENS carrying the banner, and the
  // renders above mount the banner on its own. These pin the other half: both
  // owning surfaces still mount it, so a page cannot drop the way back while
  // the banner's own tests stay green.
  describe("given the two previous screens", () => {
    const owningSurfaces = [
      "src/screens/simulations/scenario-library.screen.tsx",
      "src/ui/sections/suites/simulations-page.tsx",
    ];

    describe("when their source is read", () => {
      /** @scenario "The previous screens carry a banner back to the new ones" */
      it.each(owningSurfaces)("mounts the banner in %s", (surface) => {
        const source = readFileSync(join(process.cwd(), surface), "utf-8");

        expect(source).toMatch(/<ReturnToNewSimulationsBanner\b/);
      });
    });
  });
});
