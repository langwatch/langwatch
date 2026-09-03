/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

// The Langy announcement starts its conversation in place rather than routing.
const askLangy = vi.fn();
vi.mock("@langwatch/langy-web", () => ({
  useLangyStore: (selector: (s: unknown) => unknown) => selector({ askLangy }),
  LangyMark: () => null,
}));
vi.mock("@langwatch/langy-web/asaplangy", () => ({
  SERIF: "serif",
}));

import { HomePageBanners } from "../home-page-banners";
import {
  ProjectHomeHostProvider,
  ProjectHomeHostPort,
  type ProjectHomeDeployment,
  type ProjectHomeFlagReading,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "../../../../model/project-home-host";

// The automations banner navigates through the host on CTA click. One shared
// spy so a test can assert WHERE the click went, not just that it went.
const routerPush = vi.fn();

const hostState: {
  project: ProjectHomeProject | undefined;
  reducedMotion: boolean;
} = {
  project: { id: "project-1", name: "My Project", slug: "my-project" },
  reducedMotion: false,
};

class StubProjectHomeHost extends ProjectHomeHostPort {
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
  featureFlag(): ProjectHomeFlagReading {
    return { enabled: false, isLoading: false };
  }
  langyVisibility(): ProjectHomeLangyVisibility {
    return { show: false, isResolving: false };
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

const VOICE_KEY = "langwatch:voice-agents-home-banner-dismissed:v1:project-1";
const AUTOMATIONS_KEY = "langwatch:automations-home-banner-dismissed:v1:project-1";

/** The pill row next to a slide's heading — where the "New" badge lives. */
const headingRow = (name: string) =>
  within(screen.getByRole("heading", { name }).parentElement!);

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProjectHomeHostProvider value={new StubProjectHomeHost()}>{ui}</ProjectHomeHostProvider>
    </ChakraProvider>,
  );
}

describe("<HomePageBanners />", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    routerPush.mockClear();
    askLangy.mockClear();
    hostState.project = { id: "project-1", name: "My Project", slug: "my-project" };
    hostState.reducedMotion = false;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("leads with the automations banner, with dots, when all are eligible", () => {
    renderWithProviders(<HomePageBanners />);
    expect(screen.getByRole("heading", { name: "React the moment it matters" })).toBeDefined();
    // Two eligible banners → two navigation dots.
    expect(screen.getByRole("button", { name: "Show announcement 1 of 2" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Show announcement 2 of 2" })).toBeDefined();
  });

  it("keeps the full-colour banner for users outside the Langy rollout", () => {
    const { container } = renderWithProviders(<HomePageBanners variant="legacy" />);

    expect(container.querySelector('[data-banner-variant="legacy"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Previous announcement" })).toBeNull();
  });

  it("carries every announcement, with dots to move between them", () => {
    // Every slide in the rotation shows, always — an announcement stands until
    // it is taken out in code, so there is no state that can reduce the set.
    renderWithProviders(<HomePageBanners />);
    expect(screen.getByRole("heading", { name: "React the moment it matters" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: /Show announcement/ }).length).toBeGreaterThan(1);
  });

  it("renders nothing before the project id resolves", () => {
    // The CTA needs the project slug to route, so rendering before it lands
    // would push /undefined/automations.
    hostState.project = undefined;
    renderWithProviders(<HomePageBanners />);
    expect(screen.queryByRole("heading", { name: "React the moment it matters" })).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeNull();
  });

  it("shows an announcement a reader had previously hidden", () => {
    // There is no dismissal any more, so a stale key from when there was one
    // must not keep an announcement off the page forever.
    localStorage.setItem(AUTOMATIONS_KEY, String(Date.now() + 60_000));
    localStorage.setItem(VOICE_KEY, String(Date.now() + 60_000));
    renderWithProviders(<HomePageBanners />);
    expect(screen.getByRole("heading", { name: "React the moment it matters" })).toBeDefined();
  });

  describe("when a banner's link is followed", () => {
    it("routes in-app announcements through SPA navigation", () => {
      renderWithProviders(<HomePageBanners />);

      fireEvent.click(screen.getByRole("button", { name: /Explore automations/ }));

      expect(routerPush).toHaveBeenCalledWith("/my-project/automations");
    });

    it("keeps the announcement on the page, so the way back is not lost", () => {
      renderWithProviders(<HomePageBanners />);

      fireEvent.click(screen.getByRole("button", { name: /Explore automations/ }));

      // Still on screen: following a link is interest, not "seen it, thanks".
      expect(screen.getByRole("heading", { name: "React the moment it matters" })).toBeDefined();
      expect(localStorage.getItem(AUTOMATIONS_KEY)).toBeNull();
    });

    it("offers no way to hide an announcement at all", () => {
      renderWithProviders(<HomePageBanners />);

      expect(screen.queryAllByRole("button", { name: /Hide|Dismiss/ })).toHaveLength(0);
    });
  });

  describe("when the Langy home carries the announcements", () => {
    /** @scenario The Langy home carries an announcement about Langy */
    /** @scenario That announcement is not shown to readers without Langy */
    it("adds the Langy announcement only for the lantern", () => {
      renderWithProviders(<HomePageBanners variant="lantern" />);
      expect(screen.getByText("Langy can ship the fix, not just find it")).toBeDefined();

      cleanup();
      renderWithProviders(<HomePageBanners />);
      expect(screen.queryByText("Langy can ship the fix, not just find it")).toBeNull();
    });

    /** @scenario The Langy home carries an announcement about Langy */
    it("starts the conversation in place instead of navigating", () => {
      renderWithProviders(<HomePageBanners variant="lantern" />);

      fireEvent.click(screen.getByRole("button", { name: /Ask Langy to investigate/ }));

      expect(askLangy).toHaveBeenCalledTimes(1);
      expect(routerPush).not.toHaveBeenCalled();
    });
  });

  it("does not reintroduce a Langy promo into the announcement carousel", () => {
    renderWithProviders(<HomePageBanners />);
    expect(screen.queryByRole("heading", { name: "Meet Langy" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Langy is on its way" })).toBeNull();
    expect(headingRow("Voice agent simulations are here").getByText("New")).toBeDefined();
  });
});
