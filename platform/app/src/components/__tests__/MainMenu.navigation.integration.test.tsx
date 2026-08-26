/**
 * @vitest-environment jsdom
 *
 * @see specs/evaluations/experiments-online-evaluations-separation.feature
 * @see specs/navigation/ops-navigation-v2.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: "/[project]" }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "demo" },
    organization: { id: "organization-1" },
    hasPermission: () => true,
    isPublicRoute: false,
  }),
}));

// Every flag reads on, except the one that replaces the Simulations group
// with Agent Testing: this file pins the rail as it stands today. The rail
// under that flag is pinned by MainMenu.agentTesting.integration.test.tsx.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled: flag !== "release_ui_agent_testing_v2_enabled",
  }),
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

const visibleLinkLabels = () =>
  screen.getAllByRole("link").map((link) => link.textContent);

describe("<MainMenuSections showExpanded /> navigation", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  /** @scenario Organize the existing destinations around the product lifecycle */
  it("uses the approved section names and destination order", () => {
    render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

    const sectionControls = screen
      .getAllByRole("button", { name: /^(Collapse|Expand) / })
      .map((button) => button.getAttribute("aria-label"));

    expect(sectionControls).toEqual([
      "Collapse Observe",
      "Collapse Test",
      "Expand Build",
    ]);

    expect(visibleLinkLabels()).toEqual([
      "Home",
      "Analytics",
      "Trace Explorer",
      "Online Evals",
      "Simulations",
      "Experiments",
      "Annotations",
    ]);
  });

  /** @scenario "The sidebar no longer offers the legacy Traces page" */
  it("offers Trace Explorer as the only traces destination", () => {
    render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

    const tracesLabels = visibleLinkLabels().filter((label) =>
      /trace/i.test(label ?? ""),
    );

    expect(tracesLabels).toEqual(["Trace Explorer"]);
  });

  /** @scenario Use sensible section defaults without a saved preference */
  it("reveals the Build destinations in their existing order", async () => {
    const user = userEvent.setup();
    render(<MainMenuSections showExpanded />, { wrapper: Wrapper });

    expect(screen.queryByRole("link", { name: "Prompts" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Expand Build" }));

    const labels = visibleLinkLabels();
    const libraryStart = labels.indexOf("Prompts");
    expect(labels.slice(libraryStart, libraryStart + 6)).toEqual([
      "Prompts",
      "Agents",
      "Workflows",
      "Evaluators",
      "Datasets",
      "Automations",
    ]);
  });
});
