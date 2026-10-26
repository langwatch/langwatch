/**
 * @vitest-environment jsdom
 * The one home: what it draws with Langy and without, and its wait on Langy's gate.
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gates = {
  langy: false,
  langyResolving: false,
  isNewProject: false,
  activePlan: undefined as { free?: boolean | null } | undefined,
};

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
  homeApi: {
    plan: {
      getActivePlan: { useQuery: () => ({ data: gates.activePlan }) },
    },
  },
}));
vi.mock("@langwatch/organization-client/lent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PendingJoinRequests: () => null,
}));
vi.mock("@langwatch/ops-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  UpgradeActionNeeded: () => null,
}));
vi.mock("@langwatch/onboarding-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  GuidedOnboardingOffer: () => null,
}));
vi.mock("../components/langy-home-hero.tsx", () => ({
  LangyHomeHero: () => <div data-testid="lantern" />,
}));

vi.mock("../components/docs-guides.tsx", () => ({
  DocsGuides: () => <div data-testid="docs-guides" />,
}));
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
import { HomePage, HomeScreen } from "../home-screen.tsx";

/** The narrowest host the page can be drawn against: the org, and Langy's gate from `gates`. */
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
    return { show: gates.langy, isResolving: gates.langyResolving };
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

const homeTree = () => (
  <DesignSystemProvider forcedTheme="light">
    <ProjectHomeHostProvider value={new StubProjectHomeHost()}>
      <HomePage />
    </ProjectHomeHostProvider>
  </DesignSystemProvider>
);

const renderHome = () => render(homeTree());

afterEach(cleanup);

describe("HomePage", () => {
  beforeEach(() => {
    gates.langy = true;
    gates.langyResolving = false;
    gates.isNewProject = false;
    gates.activePlan = { free: true };
  });

  describe("given a reader with Langy", () => {
    /** @scenario The Langy home renders for a reader with Langy */
    it("leads with the lit block and keeps the spine underneath", () => {
      renderHome();

      expect(screen.getByTestId("lantern")).toBeDefined();
      expect(screen.getByTestId("recent-items")).toBeDefined();
      expect(screen.getByTestId("onboarding-checklist")).toBeDefined();
    });

    /** @scenario The block layers over the shared announcement canvas */
    it("sets the block inside the announcement surface, not beside it", () => {
      renderHome();

      const banners = screen.getByTestId("banners");
      // One canvas on the page: the block is the banner's child, so there is
      // no second announcement surface to mount a second shader in.
      expect(screen.getAllByTestId("banners")).toHaveLength(1);
      expect(banners.contains(screen.getByTestId("lantern"))).toBe(true);
    });

    /** @scenario A project with data leads its figures with the compact strip */
    it("puts the figures directly beneath the block", () => {
      renderHome();

      expect(screen.getByTestId("banners").nextElementSibling).toBe(
        screen.getByTestId("traces-overview"),
      );
    });

    /** @scenario A project with nothing in it yet still opens with the composer */
    it("promotes setup and drops the figures on a project with no data", () => {
      gates.isNewProject = true;
      renderHome();

      expect(screen.getByTestId("lantern")).toBeDefined();
      expect(screen.getByTestId("onboarding-checklist")).toBeDefined();
      expect(screen.queryByTestId("traces-overview")).toBeNull();
      expect(screen.queryByTestId("recent-items")).toBeNull();
    });

    /** @scenario The reader can reach the guided docs from this home */
    it("keeps a route into the docs, with data and without", () => {
      renderHome();
      expect(screen.getByTestId("docs-guides")).toBeDefined();

      cleanup();
      gates.isNewProject = true;
      renderHome();
      expect(screen.getByTestId("docs-guides")).toBeDefined();
    });
  });

  describe("given a reader without Langy", () => {
    /** @scenario Without Langy the home shows the command bar and says Langy isn't enabled */
    it("draws the same home, hero and spine included", () => {
      gates.langy = false;
      renderHome();

      expect(screen.getByTestId("banners").contains(screen.getByTestId("lantern"))).toBe(true);
      expect(screen.getByTestId("traces-overview")).toBeDefined();
      expect(screen.getByTestId("recent-items")).toBeDefined();
      expect(screen.getByTestId("docs-guides")).toBeDefined();
    });
  });

  describe("given Langy's gate has not answered yet", () => {
    /** @scenario The page waits rather than guessing which home it is */
    it("draws one placeholder, announced as loading, and no hero", () => {
      gates.langyResolving = true;
      renderHome();

      expect(screen.getByLabelText("Loading your home").getAttribute("aria-busy")).toBe("true");
      expect(screen.queryByTestId("banners")).toBeNull();
    });

    /** @scenario The placeholder gives way to the home once Langy's gate answers */
    it("replaces the placeholder with the home once the gate answers", () => {
      gates.langyResolving = true;
      const { rerender } = render(homeTree());

      gates.langyResolving = false;
      rerender(homeTree());

      expect(screen.queryByLabelText("Loading your home")).toBeNull();
      expect(screen.getByTestId("lantern")).toBeDefined();
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

/** The stub, told where a switch asked to land, whether the scope resolves, and the kind. */
class ReturningHomeHost extends StubProjectHomeHost {
  readonly visited: string[] = [];
  readonly replaced: string[] = [];

  constructor(
    private readonly options: { returnTo: string | undefined; isLoading: boolean; kind?: string },
  ) {
    super();
  }

  override project(): ProjectHomeProject | undefined {
    const project = super.project();
    return project && this.options.kind ? { ...project, kind: this.options.kind } : project;
  }

  override returnTo(): string | undefined {
    return this.options.returnTo;
  }

  override isLoading(): boolean {
    return this.options.isLoading;
  }

  override navigate(to?: string, options?: { replace?: boolean }): void {
    if (to === void 0) return;
    (options?.replace ? this.replaced : this.visited).push(to);
  }
}

function renderHomeRoute(host: ReturningHomeHost) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <ProjectHomeHostProvider value={host}>
        <HomeScreen />
      </ProjectHomeHostProvider>
    </DesignSystemProvider>,
  );
}

describe("the home route after a project switch", () => {
  describe("given a safe return_to and a resolved scope", () => {
    it("lands back on the page the switch came from, drawing no home", () => {
      const host = new ReturningHomeHost({ returnTo: "/settings/secrets", isLoading: false });
      renderHomeRoute(host);

      expect(host.visited).toEqual(["/settings/secrets"]);
      expect(screen.queryByTestId("traces-overview")).toBeNull();
    });
  });

  describe("given a safe return_to while the scope is still resolving", () => {
    it("waits, so the switch is remembered before the page it returns to reads it", () => {
      const host = new ReturningHomeHost({ returnTo: "/settings/secrets", isLoading: true });
      renderHomeRoute(host);

      expect(host.visited).toEqual([]);
    });
  });

  describe.each([
    ["an address on another site", "//evil.example/settings"],
    ["an absolute URL", "https://evil.example/"],
    ["no return_to at all", undefined],
  ])("given %s", (_label, returnTo) => {
    it("stays on the home and draws it", () => {
      const host = new ReturningHomeHost({ returnTo, isLoading: false });
      renderHomeRoute(host);

      expect(host.visited).toEqual([]);
      expect(screen.getByTestId("traces-overview")).toBeInTheDocument();
    });
  });
});

/** ADR-177: an aggregate has no home, so its home route lands on its Trace Explorer. */
describe("the home route of a project whose navigation has no home", () => {
  describe("given an aggregate project", () => {
    /** @scenario "Opening an aggregate's home lands on the Trace Explorer" */
    it("replaces the home with the aggregate's Trace Explorer and draws no home", () => {
      const host = new ReturningHomeHost({ returnTo: void 0, isLoading: false, kind: "aggregate" });
      renderHomeRoute(host);

      expect(host.replaced).toEqual(["/acme-app/traces"]);
      expect(host.visited).toEqual([]);
      expect(screen.queryByTestId("traces-overview")).toBeNull();
    });
  });

  describe("given an ordinary project", () => {
    it("draws the home and redirects nowhere", () => {
      const host = new ReturningHomeHost({
        returnTo: void 0,
        isLoading: false,
        kind: "application",
      });
      renderHomeRoute(host);

      expect(host.replaced).toEqual([]);
      expect(host.visited).toEqual([]);
      expect(screen.getByTestId("traces-overview")).toBeInTheDocument();
    });
  });

  describe("given an aggregate whose home carries a return_to", () => {
    it("follows the return_to instead of the Trace Explorer", () => {
      const host = new ReturningHomeHost({
        returnTo: "/acme-app/traces/trace-1",
        isLoading: false,
        kind: "aggregate",
      });
      renderHomeRoute(host);

      expect(host.visited).toEqual(["/acme-app/traces/trace-1"]);
      expect(host.replaced).toEqual([]);
    });
  });
});
