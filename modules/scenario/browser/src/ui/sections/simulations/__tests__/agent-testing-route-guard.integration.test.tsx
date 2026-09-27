/**
 * The Agent Testing address is behind the release flag, and the flag alone grants nothing.
 * @vitest-environment jsdom
 * @see specs/features/agent-testing/page-structure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ flagEnabled: true, permitted: true }));

vi.mock("../../../../behavior/use-feature-flag.ts", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled: flag === "release_ui_agent_testing_v2_enabled" && state.flagEnabled,
    isLoading: false,
  }),
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "acme" },
    organization: { id: "organization_1" },
    isLoading: false,
  }),
}));

vi.mock("../../../../model/scenario-host.ts", () => ({
  useScenarioHost: () => ({ hasPermission: () => state.permitted }),
}));

vi.mock("../../agent-testing/agent-testing-page.tsx", () => ({
  AgentTestingPage: () => <div data-testid="agent-testing-page" />,
}));

import AgentTestingRoute from "../agent-testing.screen.tsx";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
  state.flagEnabled = true;
  state.permitted = true;
});

describe("the Agent Testing route", () => {
  describe("given the release flag is off", () => {
    /** @scenario "With the flag off the Agent Testing route is not reachable" */
    it("does not show the page, and shows a page a person can read", () => {
      state.flagEnabled = false;
      render(<AgentTestingRoute />, { wrapper: Wrapper });

      expect(screen.queryByTestId("agent-testing-page")).toBeNull();
      expect(screen.getByText(/this page does not exist/)).toBeInTheDocument();
    });
  });

  describe("given the release flag is on and the person may not read scenarios", () => {
    /** @scenario "A person without permission to read scenarios cannot open the page" */
    it("refuses the page, so the flag alone grants nothing", () => {
      state.permitted = false;
      render(<AgentTestingRoute />, { wrapper: Wrapper });

      expect(screen.queryByTestId("agent-testing-page")).toBeNull();
      expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    });
  });

  describe("given the release flag is on and the person may read scenarios", () => {
    it("opens the page", () => {
      render(<AgentTestingRoute />, { wrapper: Wrapper });

      expect(screen.getByTestId("agent-testing-page")).toBeInTheDocument();
    });
  });
});
