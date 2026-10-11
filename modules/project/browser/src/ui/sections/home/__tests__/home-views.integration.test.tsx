/**
 * @vitest-environment jsdom
 * Which middle modules each home view draws, and in what order.
 * Spec: specs/home/home-views.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gates = vi.hoisted(() => ({
  isNewProject: false,
}));

vi.mock("../components/use-project-reach.ts", () => ({
  useProjectReach: () => ({
    isLoading: false,
    isNewProject: gates.isNewProject,
    hasTraces: !gates.isNewProject,
    hasEvaluations: false,
    hasExperiments: false,
  }),
}));
vi.mock("../../../../behavior/home-api.ts", () => ({
  homeApi: { plan: { getActivePlan: { useQuery: () => ({ data: { free: false } }) } } },
}));
vi.mock("../../../../behavior/lent-peers.tsx", () => ({
  PendingJoinRequests: () => null,
  UpgradeActionNeeded: () => null,
  GuidedOnboardingOffer: () => null,
}));
vi.mock("../components/langy-home-hero.tsx", () => ({
  LangyHomeHero: () => <div data-testid="lantern" />,
}));
vi.mock("../components/docs-guides.tsx", () => ({ DocsGuides: () => null }));
vi.mock("../components/home-page-banners.tsx", () => ({
  HomePageBanners: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="banners">{children}</div>
  ),
}));
vi.mock("../components/learning-resources.tsx", () => ({ LearningResources: () => null }));
vi.mock("../components/onboarding-progress.tsx", () => ({
  OnboardingProgress: () => <div data-testid="onboarding-checklist" />,
}));
vi.mock("../components/recent-items-section.tsx", () => ({
  RecentItemsSection: () => <div data-testid="recent-items" />,
}));
vi.mock("../components/traces-overview.tsx", () => ({
  TracesOverview: () => <div data-testid="traces-overview" />,
}));
vi.mock("../components/welcome-header.tsx", () => ({
  WelcomeHeader: () => null,
}));

import {
  ProjectHomeHostProvider,
  ProjectHomeHost,
  type ProjectHomeDeployment,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "../../../../model/project-home-host.ts";
import { HomePage } from "../home-screen.tsx";

class StubProjectHomeHost extends ProjectHomeHost {
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
  langyVisibility(): ProjectHomeLangyVisibility {
    return { show: true, isResolving: false };
  }
  canAskLangy(): boolean {
    return true;
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
    <DesignSystemProvider forcedTheme="light">
      <ProjectHomeHostProvider value={new StubProjectHomeHost()}>
        <HomePage />
      </ProjectHomeHostProvider>
    </DesignSystemProvider>,
  );

afterEach(cleanup);

describe("home views", () => {
  beforeEach(() => {
    gates.isNewProject = false;
  });

  describe("given a project that has never received a trace, on the Langy home", () => {
    /** @scenario "The first-run view keeps the Langy home's lit block" */
    it("leads with the lit block, the checklist directly beneath, and no figures or recent items", () => {
      gates.isNewProject = true;
      renderHome();

      const banners = screen.getByTestId("banners");
      expect(banners.contains(screen.getByTestId("lantern"))).toBe(true);
      expect(banners.nextElementSibling).toBe(screen.getByTestId("onboarding-checklist"));
      expect(screen.queryByTestId("traces-overview")).toBeNull();
      expect(screen.queryByTestId("recent-items")).toBeNull();
    });
  });
});
