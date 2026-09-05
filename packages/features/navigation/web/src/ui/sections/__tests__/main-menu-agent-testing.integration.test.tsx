/**
 * @vitest-environment jsdom
 * @see specs/features/agent-testing/page-structure.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationProject } from "../../../model/navigation-host";
import { WithStubNavigationHost } from "../../../testing";
import { MainMenuSections } from "../main-menu";

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => ({}) } },
  },
}));

const PROJECT: NavigationProject = { id: "project-1", slug: "demo", name: "Demo" };

function renderMenu({ agentTestingEnabled }: { agentTestingEnabled: boolean }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          project: PROJECT,
          pathname: "/[project]",
          permissions: ["scenarios:view"],
          flags: {
            release_ui_agent_testing_v2_enabled: {
              enabled: agentTestingEnabled,
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

const linkNamed = (label: string) => screen.queryByRole("link", { name: label });

/** The Simulations group is collapsed until it is opened, so its children are asked for. */
const simulationsGroupTrigger = () => screen.queryByRole("button", { name: /Simulations$/ });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("the Agent Testing destination in the main menu", () => {
  describe("given the Agent Testing release flag is on", () => {
    /** @scenario "With the flag on the main menu shows one Agent Testing item" */
    it("shows one Agent Testing destination", () => {
      renderMenu({ agentTestingEnabled: true });

      expect(linkNamed("Agent Testing")).toHaveAttribute("href", "/demo/agent-testing");
    });

    /** @scenario "With the flag on the main menu shows one Agent Testing item" */
    it("drops the Simulations group", () => {
      renderMenu({ agentTestingEnabled: true });

      expect(simulationsGroupTrigger()).toBeNull();
      expect(linkNamed("Scenarios")).toBeNull();
      expect(linkNamed("Runs")).toBeNull();
    });
  });

  describe("given the Agent Testing release flag is off", () => {
    /** @scenario "With the flag off the main menu is unchanged" */
    it("keeps the Simulations group with its two destinations", async () => {
      renderMenu({ agentTestingEnabled: false });

      const trigger = simulationsGroupTrigger();
      expect(trigger).toBeInTheDocument();
      fireEvent.click(trigger!);

      expect(await screen.findByRole("link", { name: "Scenarios" })).toHaveAttribute(
        "href",
        "/demo/simulations/scenarios",
      );
      expect(linkNamed("Runs")).toHaveAttribute("href", "/demo/simulations");
    });

    /** @scenario "With the flag off the main menu is unchanged" */
    it("shows no Agent Testing destination", () => {
      renderMenu({ agentTestingEnabled: false });

      expect(linkNamed("Agent Testing")).toBeNull();
    });
  });
});
