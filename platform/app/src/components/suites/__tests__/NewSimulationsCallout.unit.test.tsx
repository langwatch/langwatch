/**
 * @vitest-environment jsdom
 *
 * The Agent Testing sidebars pin an announcement that offers the way back
 * to the previous simulations screens.
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
import { NewSimulationsCallout } from "../NewSimulationsCallout";

const SNOOZE_KEY = "langwatch:new-simulations-callout-dismissed:v1:project-1";
const PREFERENCE_KEY = "langwatch:prefer-legacy-simulations:v1:project-1";
const VOICE_SNOOZE_KEY =
  "langwatch:simulations-voice-callout-dismissed:v1:project-1";

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

const bodyLink = () =>
  screen.getByRole("link", {
    name: /Go back to the previous simulations screen/i,
  });

describe("<NewSimulationsCallout />", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe("given the person dismissed the earlier voice announcement", () => {
    /** @scenario "The callout shows even after the voice announcement was dismissed" */
    it("still shows the welcome title", () => {
      localStorage.setItem(
        VOICE_SNOOZE_KEY,
        String(Date.now() + 14 * 24 * 60 * 60 * 1000),
      );

      renderWithProviders(<NewSimulationsCallout target="scenarios" />);

      expect(
        screen.getByText("Welcome to the new simulations screen"),
      ).toBeDefined();
      expect(screen.getByText("Go back")).toBeDefined();
    });
  });

  describe("when the callout sits in the suites sidebar", () => {
    /** @scenario "The sidebar callout leads back to the scenario library" */
    it("links to the previous scenario library", () => {
      renderWithProviders(<NewSimulationsCallout target="scenarios" />);

      expect(bodyLink().getAttribute("href")).toBe(
        "/demo/simulations/scenarios",
      );
    });

    /** @scenario "The sidebar callout leads back to the scenario library" */
    it("records the previous-screens preference on click", () => {
      renderWithProviders(<NewSimulationsCallout target="scenarios" />);

      fireEvent.click(bodyLink());

      expect(isLegacySimulationsPreferred("project-1")).toBe(true);
      expect(posthog.capture).toHaveBeenCalledWith(
        "new_simulations_callout_back_click",
        expect.objectContaining({ surface: "agent_testing_sidebar" }),
      );
    });
  });

  describe("when the callout sits in the results runs sidebar", () => {
    /** @scenario "The results callout leads back to the runs list" */
    it("links to the previous runs list", () => {
      renderWithProviders(<NewSimulationsCallout target="runs" />);

      expect(bodyLink().getAttribute("href")).toBe("/demo/simulations");
    });
  });

  describe("when the person clicks the dismiss button", () => {
    /** @scenario "Dismissing the callout snoozes it without navigating" */
    it("hides the callout, snoozes it, and records no preference", () => {
      renderWithProviders(<NewSimulationsCallout target="scenarios" />);

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(
        screen.queryByText("Welcome to the new simulations screen"),
      ).toBeNull();
      const stored = Number(localStorage.getItem(SNOOZE_KEY));
      expect(stored).toBeGreaterThan(Date.now());
      expect(localStorage.getItem(PREFERENCE_KEY)).toBeNull();
    });
  });

  describe("given the previous-screens preference is already recorded", () => {
    /** @scenario "A person who already went back does not see the offer again" */
    it("renders nothing", () => {
      localStorage.setItem(PREFERENCE_KEY, "1");

      renderWithProviders(<NewSimulationsCallout target="scenarios" />);

      expect(
        screen.queryByText("Welcome to the new simulations screen"),
      ).toBeNull();
    });
  });
});
