import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
/**
 * Real-Chromium paint-order test for the Langy home's lit block: jsdom paints
 * nothing, so only a browser can say which layer ends up on top of a card.
 * Spec: specs/home/langy-home.feature
 */
import { Box } from "@langwatch/design-system/primitives";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProjectHomeHost,
  ProjectHomeHostProvider,
  type ProjectHomeDeployment,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "../../../../model/project-home-host.ts";
import { HomePage } from "../home-screen.tsx";

vi.mock("@paper-design/shaders-react", () => ({ MeshGradient: () => null }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@langwatch/langy-browser-kit", () => ({
  useLangyStore: (selector: (s: unknown) => unknown) => selector({ askLangy: vi.fn() }),
  LangyMark: () => null,
  SERIF: "serif",
}));
vi.mock("../components/use-home-composition.ts", () => ({
  useHomeComposition: () => "langy",
}));
vi.mock("../components/use-project-reach.ts", () => ({
  useProjectReach: () => ({
    isLoading: false,
    isNewProject: false,
    hasTraces: true,
    hasEvaluations: false,
    hasExperiments: false,
  }),
}));
/** A free plan, so the demo row renders directly above the block. */
vi.mock("../../../../behavior/home-api.ts", () => ({
  homeApi: {
    plan: { getActivePlan: { useQuery: () => ({ data: { free: true } }) } },
  },
}));
vi.mock("../components/langy-home-hero.tsx", () => ({
  LangyHomeHero: () => <Box height="320px">Good afternoon</Box>,
}));
vi.mock("../components/traces-overview.tsx", () => ({ TracesOverview: () => null }));
vi.mock("../components/recent-items-section.tsx", () => ({ RecentItemsSection: () => null }));
vi.mock("../components/onboarding-progress.tsx", () => ({ OnboardingProgress: () => null }));
vi.mock("../components/docs-guides.tsx", () => ({ DocsGuides: () => null }));
vi.mock("../components/learning-resources.tsx", () => ({ LearningResources: () => null }));
vi.mock("../components/welcome-header.tsx", () => ({ WelcomeHeader: () => null }));

class StubProjectHomeHost extends ProjectHomeHost {
  project(): ProjectHomeProject | undefined {
    return { id: "project-1", name: "My Project", slug: "my-project" };
  }
  organization(): ProjectHomeOrganization | undefined {
    return { id: "org-1", name: "Acme" };
  }
  currentUser(): ProjectHomeUser | undefined {
    return { id: "user-1", name: "Ada" };
  }
  isLoading(): boolean {
    return false;
  }
  hasPermission(): boolean {
    return false;
  }
  langyVisibility(): ProjectHomeLangyVisibility {
    return { show: true, isResolving: false };
  }
  canAskLangy(): boolean {
    return false;
  }
  deployment(): ProjectHomeDeployment {
    return { isSaaS: true, isDevelopment: false };
  }
  reducedMotion(): boolean {
    return true;
  }
  navigate(): void {}
}

function mount(mode: "light" | "dark") {
  document.documentElement.className = mode;
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProjectHomeHostProvider value={new StubProjectHomeHost()}>
        {/* The shell's opaque page fill, which the block's light must stay above. */}
        <Box data-testid="page-fill" background="bg">
          <HomePage />
        </Box>
      </ProjectHomeHostProvider>
    </ChakraProvider>,
  );
}

/** The row directly above the block, inside the reach of its light. */
function rowAbove(): HTMLElement {
  const row = screen.getByRole("link", { name: /Request a demo/ }).parentElement;
  if (!row) throw new Error("the demo row is not rendered");
  return row;
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
      it("paints the row above the light and the light above the page", () => {
        const { container } = mount(mode);
        const card = rowAbove();
        const fill = screen.getByTestId("page-fill");
        const hidden = Array.from(container.querySelectorAll<HTMLElement>("[aria-hidden='true']"));

        expect(getComputedStyle(card).zIndex).toBe("auto");
        for (const probe of [
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ]) {
          const point = pointIn(card, probe);
          const light = hidden.filter(
            (layer) => getComputedStyle(layer).display !== "none" && covers(layer, point),
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
