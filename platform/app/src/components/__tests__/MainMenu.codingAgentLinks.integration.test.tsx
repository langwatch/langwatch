/**
 * @vitest-environment jsdom
 *
 * The project rail grows a Sessions and a Pull requests destination from what
 * the project actually recorded, and drops them again when the recording goes
 * stale. Each column drives its own destination.
 *
 * @see specs/coding-agent/project-menu-links.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as NextRouterModule from "~/utils/compat/next-router";

const state = vi.hoisted(() => ({
  project: {} as Record<string, unknown>,
  flagEnabled: true,
  permitted: true,
  /** The address the reader is standing on, as it appears in the browser. */
  path: "/demo",
}));

vi.mock("~/utils/compat/next-router", async () => {
  const actual = await vi.importActual<typeof NextRouterModule>(
    "~/utils/compat/next-router",
  );
  return {
    ...actual,
    // The real resolver rather than a hand-written route pattern: the rail
    // compares what the router reports against the pattern, so a route the
    // pattern list forgets has to fail here instead of silently reading as
    // never open.
    useRouter: () => ({ pathname: actual.resolvePathname(state.path) }),
  };
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: state.project,
    organization: { id: "organization-1" },
    hasPermission: () => state.permitted,
    isPublicRoute: false,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: state.flagEnabled }),
}));

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: {} }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      getPendingItemsCount: { useQuery: () => ({ data: 0 }) },
    },
    ops: {
      getBadgeCounts: { useQuery: () => ({ data: undefined }) },
      getDashboardSnapshot: { useQuery: () => ({ data: undefined }) },
    },
    user: {
      isAdmin: { useQuery: () => ({ data: { isAdmin: false } }) },
    },
  },
}));

vi.mock("~/components/sidebar/CollapsibleMenuGroup", () => ({
  CollapsibleMenuGroup: ({ label }: { label: string }) => (
    <a href="/demo/simulations" aria-label={label}>
      {label}
    </a>
  ),
}));

vi.mock("~/components/sidebar/SideMenuLink", () => ({
  SideMenuLink: ({
    label,
    href,
    isActive,
  }: {
    label: string;
    href: string;
    isActive?: boolean;
  }) => (
    <a
      href={href}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
    >
      {label}
    </a>
  ),
}));

vi.mock("~/components/sidebar/UsageIndicator", () => ({
  UsageIndicator: () => null,
}));

vi.mock("~/components/sidebar/SupportMenu", () => ({
  SupportMenu: () => null,
}));

vi.mock("~/components/sidebar/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));

import { MainMenuSections } from "../MainMenu";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const daysAgo = (days: number): Date =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const linkNamed = (label: string) =>
  screen.queryByRole("link", { name: label });

const projectWith = (over: Record<string, unknown> = {}) => ({
  id: "project-1",
  slug: "demo",
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
  ...over,
});

describe("<MainMenuSections showExpanded /> coding-agent destinations", () => {
  beforeEach(() => {
    state.project = projectWith();
    state.flagEnabled = true;
    state.permitted = true;
    state.path = "/demo";
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe("given the project recorded a coding-agent session in the last fifteen days", () => {
    beforeEach(() => {
      state.project = projectWith({ lastCodingAgentSessionAt: daysAgo(3) });
    });

    /** @scenario "A project that records coding-agent sessions offers the Sessions destination" */
    it("shows the Sessions destination", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Sessions")).toHaveAttribute("href", "/demo/sessions");
    });

    /** @scenario "Each destination is grown by its own signal" */
    it("leaves the Pull requests destination out until a pull request is linked", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Pull requests")).toBeNull();
    });

    it("puts the destination after Online Evals in the Observe section", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      const labels = screen
        .getAllByRole("link")
        .map((link) => link.textContent);
      expect(labels.indexOf("Sessions")).toBe(
        labels.indexOf("Online Evals") + 1,
      );
    });
  });

  describe("given the project's last coding-agent session is older than fifteen days", () => {
    beforeEach(() => {
      state.project = projectWith({ lastCodingAgentSessionAt: daysAgo(16) });
    });

    /** @scenario "A project that stopped recording coding-agent sessions loses the destination" */
    it("hides the Sessions destination", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Sessions")).toBeNull();
    });
  });

  describe("given the project had a pull request linked in the last fifteen days", () => {
    beforeEach(() => {
      state.project = projectWith({
        lastCodingAgentPullRequestAt: daysAgo(2),
      });
    });

    /** @scenario "A project whose work reaches pull requests offers the Pull requests destination" */
    it("shows the Pull requests destination", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Pull requests")).toHaveAttribute(
        "href",
        "/demo/pull-requests",
      );
    });

    /** @scenario "Each destination is grown by its own signal" */
    it("leaves the Sessions destination out when only pull requests were recorded", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Sessions")).toBeNull();
    });
  });

  describe("given both destinations are offered", () => {
    beforeEach(() => {
      state.project = projectWith({
        lastCodingAgentSessionAt: daysAgo(1),
        lastCodingAgentPullRequestAt: daysAgo(1),
      });
    });

    describe("when the reader is on the Sessions page", () => {
      /** @scenario "The rail marks the Sessions destination while the Sessions page is open" */
      it("marks Sessions as the open destination and leaves Pull requests unmarked", () => {
        state.path = "/demo/sessions";

        render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

        expect(linkNamed("Sessions")).toHaveAttribute("aria-current", "page");
        expect(linkNamed("Pull requests")).not.toHaveAttribute("aria-current");
      });
    });

    describe("when the reader is on the Pull requests page", () => {
      /** @scenario "The rail marks the Pull requests destination while the Pull requests page is open" */
      it("marks Pull requests as the open destination and leaves Sessions unmarked", () => {
        state.path = "/demo/pull-requests";

        render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

        expect(linkNamed("Pull requests")).toHaveAttribute(
          "aria-current",
          "page",
        );
        expect(linkNamed("Sessions")).not.toHaveAttribute("aria-current");
      });
    });
  });

  describe("given the project recorded nothing from a coding agent", () => {
    /** @scenario "A project with no coding-agent activity carries neither destination" */
    it("shows neither destination", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Sessions")).toBeNull();
      expect(linkNamed("Pull requests")).toBeNull();
    });
  });

  describe("given the coding-agent pages are not released for the organization", () => {
    beforeEach(() => {
      state.flagEnabled = false;
      state.project = projectWith({
        lastCodingAgentSessionAt: daysAgo(1),
        lastCodingAgentPullRequestAt: daysAgo(1),
      });
    });

    /** @scenario "Recent activity alone does not open the destinations" */
    it("shows neither destination", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Sessions")).toBeNull();
      expect(linkNamed("Pull requests")).toBeNull();
    });
  });

  describe("given the viewer may not read this project's traces", () => {
    beforeEach(() => {
      state.permitted = false;
      state.project = projectWith({
        lastCodingAgentSessionAt: daysAgo(1),
        lastCodingAgentPullRequestAt: daysAgo(1),
      });
    });

    /** @scenario "Recent activity alone does not open the destinations" */
    it("shows neither destination", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Sessions")).toBeNull();
      expect(linkNamed("Pull requests")).toBeNull();
    });
  });
});
