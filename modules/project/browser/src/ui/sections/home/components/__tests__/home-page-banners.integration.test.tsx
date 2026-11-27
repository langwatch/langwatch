/**
 * @vitest-environment jsdom
 */
import { UiAnalytics, type UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { UiHostServicesContextProvider } from "@langwatch/browser-host/capabilities";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

// The Langy announcement starts its conversation in place rather than routing.
const askLangy = vi.fn();
vi.mock("../../../../../behavior/langy/langy.store.ts", () => ({
  useLangyStore: (selector: (s: unknown) => unknown) => selector({ askLangy }),
}));

vi.mock("@langwatch/design-system/langy-mark", () => ({ LangyMark: () => null }));

import {
  ProjectHomeHostProvider,
  ProjectHomeHost,
  type ProjectHomeDeployment,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "../../../../../model/project-home-host.ts";
import { HomePageBanners } from "../home-page-banners.tsx";

// The automations banner navigates through the host on CTA click. One shared
// spy so a test can assert WHERE the click went, not just that it went.
const routerPush = vi.fn();

const hostState: {
  project: ProjectHomeProject | undefined;
  reducedMotion: boolean;
  langy: boolean;
} = {
  project: { id: "project-1", name: "My Project", slug: "my-project" },
  reducedMotion: false,
  langy: false,
};

class StubProjectHomeHost extends ProjectHomeHost {
  project(): ProjectHomeProject | undefined {
    return hostState.project;
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
    return { show: hostState.langy, isResolving: false };
  }
  canAskLangy(): boolean {
    return false;
  }
  deployment(): ProjectHomeDeployment {
    return { isSaaS: false, isDevelopment: false };
  }
  reducedMotion(): boolean {
    return hostState.reducedMotion;
  }
  navigate(to: string): void {
    routerPush(to);
  }
}

const AUTOMATIONS_KEY = "langwatch:automations-home-banner-dismissed:v1:project-1";

/** The shell's analytics destination, keeping each event instead of sending it. */
class RecordingUiAnalytics extends UiAnalytics {
  readonly events: UiAnalyticsEvent[] = [];

  track(event: UiAnalyticsEvent): void {
    this.events.push(event);
  }

  identify(): void {}

  group(): void {}

  reset(): void {}
}

let analytics = new RecordingUiAnalytics();

function renderWithProviders(ui: React.ReactElement) {
  const services = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    analytics,
  };
  return render(
    <UiHostServicesContextProvider value={services}>
      <DesignSystemProvider forcedTheme="light">
        <ProjectHomeHostProvider value={new StubProjectHomeHost()}>{ui}</ProjectHomeHostProvider>
      </DesignSystemProvider>
    </UiHostServicesContextProvider>,
  );
}

describe("<HomePageBanners />", () => {
  beforeEach(() => {
    // jsdom does not apply Chakra's layered token stylesheet.
    const sheet = document.createElement("style");
    sheet.dataset.bannerTokens = "true";
    sheet.textContent = `body {
      --chakra-colors-accent-solid: #ED8926;
      --chakra-colors-orange-muted: #FFF3E4;
      --chakra-colors-purple-solid: #805AD5;
      --chakra-colors-bg-subtle: #f8fafc;
      --chakra-colors-orange-fg: #7B341E;
      --chakra-colors-red-solid: #E53E3E;
      --chakra-colors-orange-subtle: #FFF3E4;
      --chakra-colors-teal-solid: #319795;
      --chakra-colors-cyan-solid: #00B5D8;
      --chakra-colors-cyan-subtle: #EDFDFD;
    }`;
    document.head.append(sheet);
    localStorage.clear();
    analytics = new RecordingUiAnalytics();
    vi.clearAllMocks();
    routerPush.mockClear();
    askLangy.mockClear();
    hostState.project = { id: "project-1", name: "My Project", slug: "my-project" };
    hostState.reducedMotion = false;
    hostState.langy = false;
  });

  afterEach(() => {
    document.head.querySelectorAll("style[data-banner-tokens]").forEach((node) => node.remove());
    cleanup();
    localStorage.clear();
  });

  /** @scenario "The newest features are announced first, in launch order" */
  it("announces the newest features first, in launch order, each marked new", () => {
    const headings = [
      "Red-team your agent against the OWASP LLM Top 10",
      "See every agent call across projects in one trace",
      "Follow one call across every agent it reaches",
      "React the moment it matters",
    ];
    renderWithProviders(<HomePageBanners />);
    expect(screen.getByText(headings[0]!)).toBeDefined();
    expect(screen.getByText("New")).toBeDefined();
    headings.slice(1).forEach((heading, i) => {
      fireEvent.click(screen.getByRole("button", { name: `Show announcement ${i + 2} of 4` }));
      expect(screen.getByText(heading)).toBeDefined();
      expect(screen.getByText("New")).toBeDefined();
    });
  });

  /** @scenario "Voice agent simulations are no longer announced" */
  it("no longer announces voice agent simulations", () => {
    renderWithProviders(<HomePageBanners />);
    for (let i = 1; i <= 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: `Show announcement ${i} of 4` }));
      expect(screen.queryByText(/voice agent/i)).toBeNull();
    }
  });

  describe("when an announcement is followed", () => {
    /** @scenario "Each announcement opens its feature" */
    it.each([
      [1, /Create a red team suite/, "/my-project/simulations", "red_team_banner_click"],
      [2, /Set up braids/, "/settings/braids", "braids_banner_click"],
      [4, /Explore automations/, "/my-project/automations", "automations_banner_click"],
    ])("announcement %i routes in app", (index, cta, path, event) => {
      renderWithProviders(<HomePageBanners />);
      fireEvent.click(screen.getByRole("button", { name: `Show announcement ${index} of 4` }));
      fireEvent.click(screen.getByRole("button", { name: cta }));
      expect(routerPush).toHaveBeenCalledWith(path);
      expect(analytics.events).toEqual([
        { name: event, attributes: { surface: "home_banner", projectId: "project-1" } },
      ]);
    });

    /** @scenario "Each announcement opens its feature" */
    it("opens the call graph docs in a new tab", () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      renderWithProviders(<HomePageBanners />);
      fireEvent.click(screen.getByRole("button", { name: "Show announcement 3 of 4" }));
      fireEvent.click(screen.getByRole("button", { name: /See the agent call graph/ }));
      expect(open).toHaveBeenCalledWith(
        "https://langwatch.ai/docs/observability/multi-agent-a2a#the-call-graph",
        "_blank",
        "noopener,noreferrer",
      );
      expect(routerPush).not.toHaveBeenCalled();
      expect(analytics.events).toEqual([
        {
          name: "agent_call_graph_banner_click",
          attributes: { surface: "home_banner", projectId: "project-1" },
        },
      ]);
      open.mockRestore();
    });
  });

  it("lays what it is given over the same ground", () => {
    renderWithProviders(
      <HomePageBanners>
        <div data-testid="hero" />
      </HomePageBanners>,
    );
    expect(screen.getByTestId("hero")).toBeDefined();
  });

  it("renders nothing before the project id resolves", () => {
    // The CTA needs the project slug to route, so rendering before it lands
    // would push /undefined/automations.
    hostState.project = undefined;
    renderWithProviders(<HomePageBanners />);
    expect(screen.queryByText("Red-team your agent against the OWASP LLM Top 10")).toBeNull();
  });

  it("shows an announcement a reader had previously hidden", () => {
    // There is no dismissal any more, so a stale key from when there was one
    // must not keep an announcement off the page forever.
    localStorage.setItem(AUTOMATIONS_KEY, String(Date.now() + 60_000));
    renderWithProviders(<HomePageBanners />);
    fireEvent.click(screen.getByRole("button", { name: "Show announcement 4 of 4" }));
    expect(screen.getByText("React the moment it matters")).toBeDefined();
  });

  describe("when a banner's link is followed", () => {
    it("keeps the announcement on the page, so the way back is not lost", () => {
      renderWithProviders(<HomePageBanners />);

      fireEvent.click(screen.getByRole("button", { name: /Create a red team suite/ }));

      // Still on screen: following a link is interest, not "seen it, thanks".
      expect(screen.getByText("Red-team your agent against the OWASP LLM Top 10")).toBeDefined();
      expect(localStorage).toHaveLength(0);
    });

    it("offers no way to hide an announcement at all", () => {
      renderWithProviders(<HomePageBanners />);

      expect(screen.queryAllByRole("button", { name: /Hide|Dismiss/ })).toHaveLength(0);
    });
  });

  describe("when the reader has Langy", () => {
    /** @scenario The Langy home carries an announcement about Langy */
    it("adds the Langy announcement", () => {
      hostState.langy = true;
      renderWithProviders(<HomePageBanners />);
      expect(screen.getByText("Langy can ship the fix, not just find it")).toBeDefined();
    });

    /** @scenario The Langy home carries an announcement about Langy */
    it("starts the conversation in place instead of navigating", () => {
      hostState.langy = true;
      renderWithProviders(<HomePageBanners />);

      fireEvent.click(screen.getByRole("button", { name: /Ask Langy to investigate/ }));

      expect(askLangy).toHaveBeenCalledTimes(1);
      expect(routerPush).not.toHaveBeenCalled();
    });
  });

  describe("when the reader does not have Langy", () => {
    /** @scenario That announcement is not shown to readers without Langy */
    it("carries no announcement about Langy", () => {
      renderWithProviders(<HomePageBanners />);
      expect(screen.queryByText("Langy can ship the fix, not just find it")).toBeNull();
      expect(screen.getAllByRole("button", { name: /Show announcement/ })).toHaveLength(4);
    });
  });

  it("does not reintroduce a Langy promo into the announcement carousel", () => {
    hostState.langy = true;
    renderWithProviders(<HomePageBanners />);
    expect(screen.queryByText("Meet Langy")).toBeNull();
    expect(screen.queryByText("Langy is on its way")).toBeNull();
  });
});
