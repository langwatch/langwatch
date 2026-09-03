/**
 * @vitest-environment jsdom
 *
 * The project rail's coding-agent destinations: grown from the project's
 * recorded activity, gated behind the release flag and trace-read permission.
 *
 * MOVED from `platform/app/src/components/__tests__/MainMenu.codingAgentLinks.integration.test.tsx`.
 *
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

function renderMenu(project: NavigationProject) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          project,
          pathname: "/[project]",
          permissions: ["traces:view"],
          flags: {
            release_ui_ai_governance_enabled: { enabled: true, isLoading: false },
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
