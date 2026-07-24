/**
 * @vitest-environment jsdom
 *
 * Guards the scope quick-picks against bypassing `allowedScopeTypes`.
 * The tile catalog offers ORGANIZATION + DEPARTMENT only, so the Team /
 * Project quick-pick chips must never render even when the current team /
 * project ids are supplied - otherwise a quick-pick could emit a scope kind
 * the caller explicitly disallowed.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScopeChipPicker } from "../ScopeChipPicker";

function renderPicker(node: ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);
}

describe("ScopeChipPicker quick-picks", () => {
  afterEach(cleanup);

  describe("given allowedScopeTypes restricts to org + department", () => {
    it("omits the team and project quick-picks even when their ids are set", () => {
      renderPicker(
        <ScopeChipPicker
          value={[]}
          onChange={vi.fn()}
          organizationId="org-1"
          allowedScopeTypes={["ORGANIZATION", "DEPARTMENT"]}
          singleSelect
          currentOrganizationId="org-1"
          currentTeamId="team-1"
          currentProjectId="proj-1"
        />,
      );

      expect(screen.queryByTestId("quick-scope-organization")).not.toBeNull();
      expect(screen.queryByTestId("quick-scope-team")).toBeNull();
      expect(screen.queryByTestId("quick-scope-project")).toBeNull();
    });
  });

  describe("given the default model-provider triad", () => {
    it("offers org, team and project quick-picks", () => {
      renderPicker(
        <ScopeChipPicker
          value={[]}
          onChange={vi.fn()}
          organizationId="org-1"
          singleSelect
          currentOrganizationId="org-1"
          currentTeamId="team-1"
          currentProjectId="proj-1"
        />,
      );

      expect(screen.queryByTestId("quick-scope-organization")).not.toBeNull();
      expect(screen.queryByTestId("quick-scope-team")).not.toBeNull();
      expect(screen.queryByTestId("quick-scope-project")).not.toBeNull();
    });
  });
});

describe("ScopeChipPicker single-select variant", () => {
  afterEach(cleanup);

  const projects = [
    { id: "p-prod", name: "ACME Prod", teamId: "t-acme" },
    { id: "p-web", name: "web-app", teamId: "t-acme" },
    { id: "p-bill", name: "billing-svc", teamId: "t-platform" },
  ];
  const teams = [
    { id: "t-acme", name: "QA Shared Team" },
    { id: "t-platform", name: "Platform Team" },
  ];

  describe("given a project is already selected", () => {
    it("shows the picked project in the trigger and hides the scope summary", () => {
      renderPicker(
        <ScopeChipPicker
          variant="single-select"
          allowedScopeTypes={["PROJECT"]}
          organizationId="org-1"
          availableProjects={projects}
          availableTeams={teams}
          value={[{ scopeType: "PROJECT", scopeId: "p-web" }]}
          onChange={vi.fn()}
          showSummary={false}
          placeholder="Select a project"
        />,
      );

      // The collapsed trigger reflects the current selection by name.
      expect(screen.getAllByText("web-app").length).toBeGreaterThan(0);
      // showSummary={false} keeps the config-oriented helper line out.
      expect(screen.queryByText(/can use this configuration/)).toBeNull();
    });
  });

  describe("given the personal variant of a scope is selected", () => {
    it("resolves the trigger to the personal option, not the plain scope", () => {
      // The personal variant shares scopeType+scopeId with the plain scope,
      // so the selection lookup must compare the personalOnly flag too.
      renderPicker(
        <ScopeChipPicker
          variant="single-select"
          allowedScopeTypes={["ORGANIZATION"]}
          organizationId="org-1"
          organizationName="ACME Inc"
          personalScopes
          value={[
            { scopeType: "ORGANIZATION", scopeId: "org-1", personalOnly: true },
          ]}
          onChange={vi.fn()}
          showSummary={false}
        />,
      );

      const trigger = screen.getByRole("combobox");
      expect(within(trigger).getByText("All personal projects")).toBeTruthy();
      expect(within(trigger).queryByText("ACME Inc")).toBeNull();
    });
  });

  describe("given nothing is selected yet", () => {
    it("shows the placeholder and offers no chips or quick-picks", () => {
      renderPicker(
        <ScopeChipPicker
          variant="single-select"
          allowedScopeTypes={["PROJECT"]}
          organizationId="org-1"
          availableProjects={projects}
          availableTeams={teams}
          value={[]}
          onChange={vi.fn()}
          placeholder="Select a project"
        />,
      );

      expect(screen.getAllByText("Select a project").length).toBeGreaterThan(0);
      // A plain single-select dropdown: no multi-select chips and none of the
      // org/team/project quick-pick buttons.
      expect(screen.queryByTestId("quick-scope-project")).toBeNull();
      expect(screen.queryByTestId("quick-scope-multiple")).toBeNull();
    });
  });
});
