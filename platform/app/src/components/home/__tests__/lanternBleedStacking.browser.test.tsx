/**
 * Real-Chromium paint-order test for the Langy home's lit block: jsdom paints
 * nothing, so only a browser can say which layer ends up on top of a card.
 * Spec: specs/home/langy-home.feature
 */
import { Box, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));
vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));
vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: () => true,
}));
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (selector: (s: unknown) => unknown) =>
    selector({ askLangy: vi.fn() }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    project: { id: "project-1", slug: "my-project" },
    hasPermission: () => false,
  }),
}));
vi.mock("~/utils/api", () => ({
  api: {
    plan: { getActivePlan: { useQuery: () => ({ data: { free: false } }) } },
  },
}));

vi.mock("../useHomeComposition", () => ({
  useHomeComposition: () => "langy",
}));
vi.mock("../useProjectReach", () => ({
  useProjectReach: () => ({
    isLoading: false,
    isNewProject: false,
    hasTraces: true,
    hasEvaluations: false,
    hasExperiments: false,
  }),
}));
vi.mock("../dev/HomeStateSwitcher", () => ({ HomeStateSwitcher: () => null }));
vi.mock("../dev/homeDevState", () => ({
  useHomeDevState: () => null,
  chartVariantFor: () => "strip",
}));
vi.mock("~/features/guided-onboarding/home/GuidedOnboardingOffer", () => ({
  GuidedOnboardingOffer: () => null,
}));
vi.mock("~/features/briefing", () => ({
  HomeBriefingSection: () => null,
  SetupHairline: () => null,
  BriefingMockSwitcher: () => null,
}));

/** The layout's opaque page fill, which the block's light must stay above. */
vi.mock("../../DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <Box data-testid="page-fill" background="bg">
      {children}
    </Box>
  ),
}));

/** A card directly above the block, inside the reach of its light. */
vi.mock("../PendingJoinRequests", async () => {
  const { HomeCard } = await import("../HomeCard");
  return {
    PendingJoinRequests: () => (
      <Box width="full" data-testid="card-above">
        <HomeCard>
          <Box padding={4} height="80px">
            Waiting to join
          </Box>
        </HomeCard>
      </Box>
    ),
  };
});
vi.mock("../LangyHomeHero", () => ({
  LangyHomeHero: () => <Box height="320px">Good afternoon</Box>,
}));
vi.mock("../TracesOverview", () => ({ TracesOverview: () => null }));
vi.mock("../RecentItemsSection", () => ({ RecentItemsSection: () => null }));
vi.mock("../OnboardingProgress", () => ({ OnboardingProgress: () => null }));
vi.mock("../DocsGuides", () => ({ DocsGuides: () => null }));
vi.mock("../HomeFortune", () => ({ HomeFortune: () => null }));
vi.mock("../LearningResources", () => ({ LearningResources: () => null }));
vi.mock("../WelcomeHeader", () => ({
  WelcomeHeader: () => null,
  useTimeOfDay: () => "afternoon",
}));

import { HomePage } from "../HomePage";

function mount(mode: "light" | "dark") {
  document.documentElement.className = mode;
  return render(
    <ChakraProvider value={defaultSystem}>
      <HomePage />
    </ChakraProvider>,
  );
}

/**
 * The bleed layers opt out of hit-testing, which also hides them from
 * elementsFromPoint. Opting them back in lets the probe report paint order.
 */
function makeHitTestable(layers: HTMLElement[]) {
  for (const layer of layers) layer.style.pointerEvents = "auto";
}

function pointIn(element: HTMLElement, { x, y }: { x: number; y: number }) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width * x, y: box.top + box.height * y };
}

function covers(element: HTMLElement, { x, y }: { x: number; y: number }) {
  const box = element.getBoundingClientRect();
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** Paint position of an element or its content: 0 is topmost, -1 is absent. */
function depthOf(element: HTMLElement, point: { x: number; y: number }) {
  return document
    .elementsFromPoint(point.x, point.y)
    .findIndex((hit) => element === hit || element.contains(hit));
}

/** Paint position of the element's own box, ignoring anything inside it. */
function ownDepthOf(element: HTMLElement, point: { x: number; y: number }) {
  return document.elementsFromPoint(point.x, point.y).indexOf(element);
}

describe("the Langy home's lit block", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.className = "";
  });

  for (const mode of ["light", "dark"] as const) {
    describe(`given the home renders in ${mode} mode`, () => {
      /** @scenario "The block's light stays behind the cards around it" */
      it("paints the card above the light and the light above the page", () => {
        const { container } = mount(mode);
        const card = screen.getByTestId("card-above");
        const fill = screen.getByTestId("page-fill");
        const hidden = Array.from(
          container.querySelectorAll<HTMLElement>("[aria-hidden='true']"),
        );

        for (const probe of [
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ]) {
          const point = pointIn(card, probe);
          const light = hidden.filter(
            (layer) =>
              getComputedStyle(layer).display !== "none" &&
              covers(layer, point),
          );
          expect(light.length).toBeGreaterThan(0);
          makeHitTestable(light);

          const cardDepth = depthOf(card, point);
          expect(cardDepth).toBe(0);
          for (const layer of light) {
            const lightDepth = depthOf(layer, point);
            expect(lightDepth).toBeGreaterThan(cardDepth);
            expect(lightDepth).toBeLessThan(ownDepthOf(fill, point));
          }
        }
      });
    });
  }
});
