/**
 * @vitest-environment jsdom
 *
 * Integration test for HomePage's two compositions. The switch under test is
 * the ROLLOUT decision: which home renders is decided only by
 * useShowSignalFocusedHome, never by Langy access — Langy access only feeds
 * affordances INSIDE whichever composition renders.
 *
 * Spec: specs/home/signal-focused-home-rollout.feature
 *
 * Boundary mocks: the two gate hooks and every section component (each
 * section carries its own data fetching; the composition choice is the page's
 * only logic).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gates = { signalFocusedHome: false, langy: false };

vi.mock("./useShowSignalFocusedHome", () => ({
  useShowSignalFocusedHome: () => gates.signalFocusedHome,
}));
vi.mock("~/features/langy/hooks/useShowLangy", () => ({
  useShowLangy: () => gates.langy,
}));

vi.mock("../DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("~/features/briefing", () => ({
  HomeBriefingSection: () => <div data-testid="briefing-sheet" />,
  SetupHairline: () => <div data-testid="setup-hairline" />,
  BriefingMockSwitcher: () => null,
}));
vi.mock("./DocsGuides", () => ({ DocsGuides: () => null }));
vi.mock("./HomeFortune", () => ({ HomeFortune: () => null }));
vi.mock("./HomePageBanners", () => ({
  HomePageBanners: ({ variant }: { variant?: string }) => (
    <div data-testid="banners" data-variant={variant ?? "default"} />
  ),
}));
vi.mock("./LearningResources", () => ({ LearningResources: () => null }));
vi.mock("./OnboardingProgress", () => ({
  OnboardingProgress: () => <div data-testid="onboarding-checklist" />,
}));
vi.mock("./RecentItemsSection", () => ({
  RecentItemsSection: () => <div data-testid="recent-items" />,
}));
vi.mock("./TimeOfDayAura", () => ({ TimeOfDayAura: () => null }));
vi.mock("./TracesOverview", () => ({
  TracesOverview: ({
    showInvestigateSignal,
  }: {
    showInvestigateSignal?: boolean;
  }) => (
    <div
      data-testid="traces-overview"
      data-investigate={String(showInvestigateSignal ?? false)}
    />
  ),
}));
vi.mock("./WelcomeHeader", () => ({
  WelcomeHeader: () => null,
  useTimeOfDay: () => "morning",
}));

import { HomePage } from "./HomePage";

const renderHome = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <HomePage />
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("HomePage composition", () => {
  beforeEach(() => {
    gates.signalFocusedHome = false;
    gates.langy = false;
  });

  describe("given the signal-focused home is enabled but Langy is not", () => {
    /** @scenario The rollout decides the composition, not Langy */
    it("leads with the briefing sheet and drops the classic sections", () => {
      gates.signalFocusedHome = true;
      renderHome();

      expect(screen.getByTestId("briefing-sheet")).toBeDefined();
      expect(screen.queryByTestId("traces-overview")).toBeNull();
      expect(screen.queryByTestId("onboarding-checklist")).toBeNull();
    });
  });

  describe("given Langy access without the signal-focused rollout", () => {
    /** @scenario Langy alone no longer switches the home */
    it("keeps the classic home, with Langy feeding only its affordances", () => {
      gates.langy = true;
      renderHome();

      // The composition stays classic...
      expect(screen.queryByTestId("briefing-sheet")).toBeNull();
      expect(screen.getByTestId("banners").dataset.variant).toBe("legacy");
      expect(screen.getByTestId("recent-items")).toBeDefined();
      expect(screen.getByTestId("onboarding-checklist")).toBeDefined();
      // ...while Langy access still reaches the affordances inside it.
      expect(screen.getByTestId("traces-overview").dataset.investigate).toBe(
        "true",
      );
    });
  });
});
