/**
 * With the flag on, the Agent Testing address opens the real page: its header and its tabs.
 * @vitest-environment jsdom
 * @see specs/features/agent-testing/page-structure.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "acme" },
    organization: { id: "organization_1" },
    isLoading: false,
  }),
}));

vi.mock("../../../../model/scenario-host.ts", () => ({
  useScenarioHost: () => ({ hasPermission: () => true }),
}));

vi.mock("../../../../behavior/agent-testing/use-agent-testing-routing.ts", () => ({
  useAgentTestingRouting: () => ({ tab: "cases", setTab: vi.fn() }),
}));
vi.mock("../../../../behavior/agent-testing/use-agent-testing-live-updates.ts", () => ({
  useAgentTestingLiveUpdates: () => ({ isSseConnected: false }),
}));
vi.mock("../../../../behavior/scenarios/use-scenarios.ts", () => ({
  useScenarios: () => ({ data: [{ id: "a" }, { id: "b" }] }),
}));
vi.mock("../../../../behavior/suites/use-suites.ts", () => ({
  useSuites: () => ({ data: [] }),
}));
vi.mock("../../../../behavior/use-preload-drawer.ts", () => ({ usePreloadDrawer: () => {} }));
vi.mock("../../agent-testing/use-agent-testing-page-flows.ts", () => ({
  useHydrateViewFromUrl: () => {},
}));
vi.mock("../../agent-testing/cases/test-cases-tab.tsx", () => ({
  TestCasesTab: () => <div data-testid="cases-tab" />,
}));
vi.mock("../../agent-testing/results/results-tab.tsx", () => ({
  ResultsTab: () => <div data-testid="results-tab" />,
}));
vi.mock("../../agent-testing/cases/agent-testing-case-editor.tsx", () => ({
  AgentTestingCaseEditor: () => null,
}));
vi.mock("../../agent-testing/run/run-plan-dialog-host.tsx", () => ({
  RunPlanDialogHost: () => null,
}));

import AgentTestingRoute from "../agent-testing.screen.tsx";

afterEach(cleanup);

describe("the Agent Testing address with the release flag on", () => {
  describe("when it is opened by a person who may read scenarios", () => {
    /** @scenario "With the flag on the Agent Testing page opens" */
    it("shows the page with its header and its tabs", () => {
      renderWithDesignSystem(<AgentTestingRoute />);

      expect(screen.getByRole("heading", { name: "Agent Testing" })).toBeInTheDocument();
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        expect.stringContaining("Scenarios"),
        expect.stringContaining("Results"),
      ]);
      expect(screen.getByTestId("cases-tab")).toBeInTheDocument();
    });
  });
});
