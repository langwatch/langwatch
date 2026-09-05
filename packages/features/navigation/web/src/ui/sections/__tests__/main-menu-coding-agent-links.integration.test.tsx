/**
 * @vitest-environment jsdom
 * Spec: specs/coding-agent/project-menu-links.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WithStubNavigationHost } from "../../../testing";
import type { NavigationProject } from "../../../model/navigation-host";
import { MainMenuSections } from "../main-menu";

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => ({}) } },
  },
}));

const PROJECT: NavigationProject = { id: "project-1", slug: "project-1", name: "Project" };
const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000);

function renderMenu(
  project: NavigationProject,
  options: { pathname?: string; permissions?: string[]; codingAgentEnabled?: boolean } = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          project,
          pathname: options.pathname ?? "/[project]",
          permissions: options.permissions ?? ["traces:view"],
          flags: {
            release_ui_ai_governance_enabled: {
              enabled: options.codingAgentEnabled ?? true,
              isLoading: false,
            },
          },
        }}
      >
        <MainMenuSections showExpanded />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("given a project that recorded a coding-agent session in the last fifteen days", () => {
  /** @scenario "A project that records coding-agent sessions offers the Sessions destination" */
  it("offers the Sessions destination", () => {
    renderMenu({ ...PROJECT, lastCodingAgentSessionAt: daysAgo(1) });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });
});

describe("given a project that recorded nothing from a coding agent", () => {
  /** @scenario "A project with no coding-agent activity carries neither destination" */
  it("offers neither coding-agent destination", () => {
    renderMenu({ ...PROJECT });

    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.queryByText("Pull requests")).not.toBeInTheDocument();
  });
});

describe("given a project whose last coding-agent session is older than fifteen days", () => {
  /** @scenario "A project that stopped recording coding-agent sessions loses the destination" */
  it("no longer offers the Sessions destination", () => {
    renderMenu({ ...PROJECT, lastCodingAgentSessionAt: daysAgo(16) });

    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
  });
});

describe("given a project that had a pull request linked in the last fifteen days", () => {
  /** @scenario "A project whose work reaches pull requests offers the Pull requests destination" */
  it("offers the Pull requests destination", () => {
    renderMenu({ ...PROJECT, lastCodingAgentPullRequestAt: daysAgo(1) });

    expect(screen.getByText("Pull requests")).toBeInTheDocument();
  });
});

describe("given a project that recorded coding-agent sessions and has no pull request linked", () => {
  /** @scenario "Each destination is grown by its own signal" */
  it("offers the Sessions destination and not the Pull requests destination", () => {
    renderMenu({ ...PROJECT, lastCodingAgentSessionAt: daysAgo(1) });

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.queryByText("Pull requests")).not.toBeInTheDocument();
  });
});

describe("given a project that recorded coding-agent sessions and pull requests today", () => {
  /** @scenario "Recent activity alone does not open the destinations" */
  it("offers neither destination when the coding-agent pages are not released", () => {
    renderMenu(
      {
        ...PROJECT,
        lastCodingAgentSessionAt: daysAgo(0),
        lastCodingAgentPullRequestAt: daysAgo(0),
      },
      { codingAgentEnabled: false },
    );

    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.queryByText("Pull requests")).not.toBeInTheDocument();
  });

  /** @scenario "Recent activity alone does not open the destinations" */
  it("offers neither destination when the viewer may not read the project's traces", () => {
    renderMenu(
      {
        ...PROJECT,
        lastCodingAgentSessionAt: daysAgo(0),
        lastCodingAgentPullRequestAt: daysAgo(0),
      },
      { permissions: [] },
    );

    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.queryByText("Pull requests")).not.toBeInTheDocument();
  });
});

describe("given a member reading the project's Sessions page", () => {
  /** @scenario "The rail marks the Sessions destination while the Sessions page is open" */
  it("marks the Sessions destination as open, and not the Pull requests destination", () => {
    renderMenu(
      {
        ...PROJECT,
        lastCodingAgentSessionAt: daysAgo(1),
        lastCodingAgentPullRequestAt: daysAgo(1),
      },
      { pathname: "/[project]/sessions" },
    );

    expect(screen.getByText("Sessions").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Pull requests").closest("a")).not.toHaveAttribute("aria-current");
  });
});

describe("given a member reading the project's Pull requests page", () => {
  /** @scenario "The rail marks the Pull requests destination while the Pull requests page is open" */
  it("marks the Pull requests destination as open, and not the Sessions destination", () => {
    renderMenu(
      {
        ...PROJECT,
        lastCodingAgentSessionAt: daysAgo(1),
        lastCodingAgentPullRequestAt: daysAgo(1),
      },
      { pathname: "/[project]/pull-requests" },
    );

    expect(screen.getByText("Pull requests").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Sessions").closest("a")).not.toHaveAttribute("aria-current");
  });
});
