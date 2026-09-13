/**
 * @vitest-environment jsdom
 *
 * The Test section of the main menu carries one Agent Testing destination
 * once the release flag is on, and the Simulations group exactly as it is
 * while the flag is off.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as NextRouterModule from "~/utils/compat/next-router";

const state = vi.hoisted(() => ({
  agentTestingEnabled: false,
  path: "/demo",
}));

vi.mock("~/utils/compat/next-router", async () => {
  const actual = await vi.importActual<typeof NextRouterModule>(
    "~/utils/compat/next-router",
  );
  return {
    ...actual,
    useRouter: () => ({ pathname: actual.resolvePathname(state.path) }),
  };
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "demo" },
    organization: { id: "organization-1" },
    hasPermission: () => true,
    isPublicRoute: false,
  }),
}));

// Only the Agent Testing flag answers, so a second flag turning on cannot make
// this pass by accident.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled:
      flag === "release_ui_agent_testing_v2_enabled"
        ? state.agentTestingEnabled
        : false,
    isLoading: false,
  }),
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
  CollapsibleMenuGroup: ({
    label,
    children,
  }: {
    label: string;
    children: { label: string; href: string }[];
  }) => (
    <div>
      <a href="/demo/simulations" aria-label={label}>
        {label}
      </a>
      {children.map((child) => (
        <a key={child.label} href={child.href} aria-label={child.label}>
          {child.label}
        </a>
      ))}
    </div>
  ),
}));

vi.mock("~/components/sidebar/SideMenuLink", () => ({
  SideMenuLink: ({ label, href }: { label: string; href: string }) => (
    <a href={href} aria-label={label}>
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

const linkNamed = (label: string) =>
  screen.queryByRole("link", { name: label });

describe("<MainMenuSections showExpanded /> Agent Testing destination", () => {
  beforeEach(() => {
    state.agentTestingEnabled = false;
    state.path = "/demo";
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe("given the Agent Testing release flag is on", () => {
    beforeEach(() => {
      state.agentTestingEnabled = true;
    });

    /** @scenario "With the flag on the main menu shows one Agent Testing item" */
    it("shows one Agent Testing destination", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Agent Testing")).toHaveAttribute(
        "href",
        "/demo/agent-testing",
      );
    });

    /** @scenario "With the flag on the main menu shows one Agent Testing item" */
    it("drops the Simulations group", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Simulations")).toBeNull();
      expect(linkNamed("Scenarios")).toBeNull();
      expect(linkNamed("Runs")).toBeNull();
    });
  });

  describe("given the flag is on and the previous-screens preference is recorded", () => {
    beforeEach(() => {
      state.agentTestingEnabled = true;
      localStorage.setItem(
        "langwatch:prefer-legacy-simulations:v1:project-1",
        "1",
      );
    });

    /** @scenario "The previous-screens preference restores the Simulations menu" */
    it("offers the Simulations group instead of Agent Testing", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Simulations")).toBeInTheDocument();
      expect(linkNamed("Agent Testing")).toBeNull();
    });
  });

  describe("given the Agent Testing release flag is off", () => {
    /** @scenario "With the flag off the main menu is unchanged" */
    it("keeps the Simulations group with its two destinations", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Simulations")).toBeInTheDocument();
      expect(linkNamed("Scenarios")).toHaveAttribute(
        "href",
        "/demo/simulations/scenarios",
      );
      expect(linkNamed("Runs")).toHaveAttribute("href", "/demo/simulations");
    });

    /** @scenario "With the flag off the main menu is unchanged" */
    it("shows no Agent Testing destination", () => {
      render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

      expect(linkNamed("Agent Testing")).toBeNull();
    });
  });
});
