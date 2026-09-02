/**
 * @vitest-environment jsdom
 *
 * Integration test for HomePage's three compositions and, above all, the ORDER
 * they resolve in: the signal-focused home wins outright, the Langy home needs
 * both Langy access and its own rollout, and everything else is the classic
 * home. Langy access alone still switches nothing.
 *
 * Spec: specs/home/signal-focused-home-rollout.feature,
 *       specs/home/langy-home.feature
 *
 * Boundary mocks: the composition resolver and every section component (each
 * section carries its own data fetching; the composition choice is the page's
 * only logic).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gates = {
  composition: "classic" as "signal-focused" | "langy" | "classic",
  langy: false,
  isNewProject: false,
  activePlan: undefined as { free?: boolean | null } | undefined,
};

vi.mock("../components/useHomeComposition", () => ({
  useHomeComposition: () => gates.composition,
}));
vi.mock("../components/useProjectReach", () => ({
  useProjectReach: () => ({
    isLoading: false,
    isNewProject: gates.isNewProject,
    hasTraces: !gates.isNewProject,
    hasEvaluations: false,
    hasExperiments: false,
  }),
}));
vi.mock("../components/dev/HomeStateSwitcher", () => ({ HomeStateSwitcher: () => null }));
vi.mock("../components/dev/homeDevState", () => ({
  useHomeDevState: () => null,
  chartVariantFor: () => "strip",
}));
vi.mock("../../../behavior/home-api", () => ({
  homeApi: {
    plan: {
      getActivePlan: { useQuery: () => ({ data: gates.activePlan }) },
    },
  },
}));
vi.mock("../components/LangyHomeHero", () => ({
  LangyHomeHero: () => <div data-testid="lantern" />,
}));

vi.mock("../briefing", () => ({
  HomeBriefingSection: () => <div data-testid="briefing-sheet" />,
  SetupHairline: () => <div data-testid="setup-hairline" />,
  BriefingMockSwitcher: () => null,
}));
vi.mock("../components/DocsGuides", () => ({
  DocsGuides: () => <div data-testid="docs-guides" />,
}));
vi.mock("../components/HomeFortune", () => ({ HomeFortune: () => null }));
vi.mock("../components/HomePageBanners", () => ({
  HomePageBanners: ({
    variant,
    children,
  }: {
    variant?: string;
    children?: React.ReactNode;
  }) => (
    <div data-testid="banners" data-variant={variant ?? "default"}>
      {children}
    </div>
  ),
}));
vi.mock("../components/LearningResources", () => ({ LearningResources: () => null }));
vi.mock("../components/OnboardingProgress", () => ({
  OnboardingProgress: () => <div data-testid="onboarding-checklist" />,
}));
vi.mock("../components/RecentItemsSection", () => ({
  RecentItemsSection: () => <div data-testid="recent-items" />,
}));
vi.mock("../components/TracesOverview", () => ({
  TracesOverview: ({ variant }: { variant?: string }) => (
    <div data-testid="traces-overview" data-variant={variant ?? "full"} />
  ),
}));
vi.mock("../components/WelcomeHeader", () => ({
  WelcomeHeader: () => null,
  useTimeOfDay: () => "morning",
}));

import { HomePage } from "../home.screen";
import {
  ProjectHomeHostProvider,
  ProjectHomeHostPort,
  type ProjectHomeDeployment,
  type ProjectHomeFlagReading,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "../../../model/project-home-host";

/**
 * The narrowest host the page can be drawn against.
 *
 * The composition itself is stubbed above — this suite is about the ORDER the
 * three homes resolve in, not about the gates — so what the host has to answer
 * is the organization the "Considering LangWatch?" ask is read for, and
 * fail-closed nothings for the rest.
 */
class StubProjectHomeHost extends ProjectHomeHostPort {
  project(): ProjectHomeProject | undefined {
    return { id: "project-1", name: "Acme App", slug: "acme-app" };
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
  featureFlag(): ProjectHomeFlagReading {
    return { enabled: false, isLoading: false };
  }
  langyVisibility(): ProjectHomeLangyVisibility {
    return { show: gates.langy, isResolving: false };
  }
  canAskLangy(): boolean {
    return gates.langy;
  }
  deployment(): ProjectHomeDeployment {
    return { isSaaS: false, isDevelopment: false };
  }
  reducedMotion(): boolean {
    return true;
  }
  navigate(): void {}
}

const renderHome = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ProjectHomeHostProvider value={new StubProjectHomeHost()}>
        <HomePage />
      </ProjectHomeHostProvider>
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("HomePage composition", () => {
  beforeEach(() => {
    gates.composition = "classic";
    gates.langy = false;
    gates.isNewProject = false;
    gates.activePlan = { free: true };
  });

  describe("given the signal-focused home is enabled but Langy is not", () => {
    /** @scenario The rollout decides the composition, not Langy */
    it("leads with the briefing sheet and drops the classic sections", () => {
      gates.composition = "signal-focused";
      renderHome();

      expect(screen.getByTestId("briefing-sheet")).toBeDefined();
      expect(screen.queryByTestId("traces-overview")).toBeNull();
      expect(screen.queryByTestId("onboarding-checklist")).toBeNull();
      expect(screen.queryByTestId("lantern")).toBeNull();
    });
  });

  describe("given Langy access without either home rollout", () => {
    // Unbound on purpose: the spec scenario this pinned was removed when
    // "having Langy is having the Langy home" landed (langy-home.feature).
    // The test stays while the code still has this state; reconcile in #3338.
    it("keeps the classic home, with Langy feeding only its affordances", () => {
      gates.langy = true;
      renderHome();

      // The composition stays classic...
      expect(screen.queryByTestId("briefing-sheet")).toBeNull();
      expect(screen.getByTestId("banners").dataset.variant).toBe("legacy");
      expect(screen.getByTestId("recent-items")).toBeDefined();
      expect(screen.getByTestId("onboarding-checklist")).toBeDefined();
      expect(screen.queryByTestId("lantern")).toBeNull();
    });
  });

  describe("given the Langy home is the resolved composition", () => {
    /** @scenario The Langy home renders when the signal-focused home is off */
    it("leads with the lit block and keeps the spine underneath", () => {
      gates.composition = "langy";
      gates.langy = true;
      renderHome();

      expect(screen.getByTestId("lantern")).toBeDefined();
      expect(screen.queryByTestId("briefing-sheet")).toBeNull();
      expect(screen.getByTestId("recent-items")).toBeDefined();
      expect(screen.getByTestId("onboarding-checklist")).toBeDefined();
    });

    /** @scenario The block layers over the shared announcement canvas */
    it("sets the block inside the announcement surface, not beside it", () => {
      gates.composition = "langy";
      renderHome();

      const banners = screen.getByTestId("banners");
      expect(banners.dataset.variant).toBe("lantern");
      // One canvas on the page: the block is the banner's child, so there is
      // no second announcement surface to mount a second shader in.
      expect(screen.getAllByTestId("banners")).toHaveLength(1);
      expect(banners.contains(screen.getByTestId("lantern"))).toBe(true);
    });

    /** @scenario A project with data leads its figures with the compact strip */
    it("renders the overview as the compact strip", () => {
      gates.composition = "langy";
      renderHome();

      expect(screen.getByTestId("traces-overview").dataset.variant).toBe("strip");
    });

    /** @scenario A project with nothing in it yet still opens with the composer */
    it("promotes setup and drops the figures on a project with no data", () => {
      gates.composition = "langy";
      gates.isNewProject = true;
      renderHome();

      expect(screen.getByTestId("lantern")).toBeDefined();
      expect(screen.getByTestId("onboarding-checklist")).toBeDefined();
      expect(screen.queryByTestId("traces-overview")).toBeNull();
      expect(screen.queryByTestId("recent-items")).toBeNull();
    });

    /** @scenario The reader can reach the guided docs from this home */
    it("keeps a route into the docs, with data and without", () => {
      gates.composition = "langy";
      renderHome();
      expect(screen.getByTestId("docs-guides")).toBeDefined();

      cleanup();
      gates.isNewProject = true;
      renderHome();
      expect(screen.getByTestId("docs-guides")).toBeDefined();
    });
  });

  describe("given the organization already pays for LangWatch", () => {
    /** @scenario A paying customer is not pitched the product they already pay for */
    it("drops both the considering line and the demo request", () => {
      gates.activePlan = { free: false };
      renderHome();

      expect(screen.queryByText(/Considering LangWatch/)).toBeNull();
      expect(screen.queryByText("Request a demo")).toBeNull();
    });
  });

  describe("given the organization is on the free plan", () => {
    /** @scenario The ask is still there for an account that might buy */
    it("keeps the ask, line and pill together", () => {
      gates.activePlan = { free: true };
      renderHome();

      expect(screen.getByText(/Considering LangWatch/)).toBeDefined();
      expect(screen.getByText("Request a demo")).toBeDefined();
    });
  });

  describe("given the plan has not resolved yet", () => {
    /** @scenario The ask never flashes at a paying customer */
    it("hides the ask rather than risk pitching a paying customer", () => {
      gates.activePlan = undefined;
      renderHome();

      expect(screen.queryByText(/Considering LangWatch/)).toBeNull();
      expect(screen.queryByText("Request a demo")).toBeNull();
    });
  });
});
