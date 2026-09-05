/**
 * @vitest-environment jsdom
 * @see specs/features/agent-testing/page-structure.feature
 */

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { WithStubNavigationHost } from "../../testing";
import { useFilteredCommands } from "../use-filtered-commands";

function navigationIdsFor({
  query,
  agentTestingEnabled,
}: {
  query: string;
  agentTestingEnabled: boolean;
}): string[] {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WithStubNavigationHost
      readings={{
        project: { id: "project-1", slug: "demo", name: "Demo" },
        pathname: "/[project]",
        flags: {
          release_ui_agent_testing_v2_enabled: {
            enabled: agentTestingEnabled,
            isLoading: false,
          },
        },
      }}
    >
      {children}
    </WithStubNavigationHost>
  );

  const { result } = renderHook(() => useFilteredCommands(query, true, "project-1", false), {
    wrapper,
  });
  return result.current.navigation.map((command) => command.id);
}

beforeEach(() => {
  localStorage.clear();
});

describe("Quick Search and the Agent Testing release flag", () => {
  describe("given the flag is on", () => {
    describe("when a term reaches Quick Search", () => {
      /** @scenario "Quick Search offers Agent Testing while the flag is on" */
      it("offers Agent Testing and hides the Simulations entries it replaces", () => {
        expect(navigationIdsFor({ query: "agent testing", agentTestingEnabled: true })).toContain(
          "nav-agent-testing",
        );

        const simulationIds = navigationIdsFor({
          query: "simulation",
          agentTestingEnabled: true,
        });
        expect(simulationIds).not.toContain("nav-simulations");
        expect(simulationIds).not.toContain("nav-scenarios");
      });
    });
  });

  describe("given the flag is off", () => {
    describe("when a term reaches Quick Search", () => {
      /** @scenario "Quick Search keeps the Simulations entries while the flag is off" */
      it("offers Simulations and hides Agent Testing", () => {
        expect(navigationIdsFor({ query: "simulations", agentTestingEnabled: false })).toContain(
          "nav-simulations",
        );
        expect(
          navigationIdsFor({ query: "agent testing", agentTestingEnabled: false }),
        ).not.toContain("nav-agent-testing");
      });
    });
  });
});
