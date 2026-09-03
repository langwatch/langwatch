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
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScopeChipPicker } from "../scope-chip-picker";

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

describe("ScopeChipPicker multi-select zero-state", () => {
  afterEach(cleanup);

  describe("given quick-picks with zero scopes selected", () => {
    describe("when the picker renders", () => {
      /** @scenario zero selected reads "None selected", never "Multiple" */
      it("labels the active chip None selected, never Multiple", () => {
        renderPicker(
          <ScopeChipPicker
            value={[]}
            onChange={vi.fn()}
            organizationId="org-1"
            showQuickPicks
            currentOrganizationId="org-1"
            currentTeamId="team-1"
            currentProjectId="proj-1"
          />,
        );

        const chip = screen.getByTestId("quick-scope-multiple");
        expect(chip.getAttribute("aria-pressed")).toBe("true");
        expect(within(chip).getByText("None selected")).toBeDefined();
        expect(screen.queryByText("Multiple")).toBeNull();
      });
    });
  });

  describe("given two scopes selected", () => {
    describe("when the picker renders", () => {
      it("keeps the Multiple label for a real multi-scope selection", () => {
        renderPicker(
          <ScopeChipPicker
            value={[
              { scopeType: "TEAM", scopeId: "team-1" },
              { scopeType: "TEAM", scopeId: "team-2" },
            ]}
            onChange={vi.fn()}
            organizationId="org-1"
            availableTeams={[
              { id: "team-1", name: "Alpha Team" },
              { id: "team-2", name: "Beta Team" },
            ]}
            showQuickPicks
            currentOrganizationId="org-1"
            currentTeamId="team-1"
          />,
        );

        const chip = screen.getByTestId("quick-scope-multiple");
        expect(within(chip).getByText("Multiple")).toBeDefined();
        expect(screen.queryByText("None selected")).toBeNull();
      });
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
          value={[{ scopeType: "ORGANIZATION", scopeId: "org-1", personalOnly: true }]}
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

describe("ScopeChipPicker search and team grouping", () => {
  afterEach(cleanup);

  const teams = [
    { id: "t-acme", name: "QA Shared Team" },
    { id: "t-platform", name: "Platform Team" },
  ];

  /** Nine projects across two teams: with the org option, past the search threshold. */
  const manyProjects = [
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `p-qa-${index}`,
      name: `qa-app-${index}`,
      teamId: "t-acme",
    })),
    { id: "p-bill", name: "billing-svc", teamId: "t-platform" },
    { id: "p-edge", name: "edge-router", teamId: "t-platform" },
  ];

  async function openDropdown() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    return user;
  }

  /** The dropdown list. Ark mirrors every label into a hidden native
   *  `<select>`, so queries must stay inside the listbox. */
  function listbox() {
    return within(screen.getByRole("listbox"));
  }

  describe("given projects across two teams", () => {
    /** @scenario Projects group under their team name */
    it("lists each project under a group header carrying its team name", async () => {
      renderPicker(
        <ScopeChipPicker
          value={[]}
          onChange={vi.fn()}
          organizationId="org-1"
          organizationName="ACME Inc"
          availableTeams={teams}
          availableProjects={[
            { id: "p-web", name: "web-app", teamId: "t-acme" },
            { id: "p-bill", name: "billing-svc", teamId: "t-platform" },
            { id: "p-lost", name: "orphan-app" },
          ]}
        />,
      );
      await openDropdown();

      await waitFor(() => {
        expect(listbox().getByText("web-app")).toBeInTheDocument();
      });
      const groups = listbox().getAllByRole("group");
      const groupHolding = ({ label, item }: { label: string; item: string }) =>
        groups.some(
          (group) =>
            within(group).queryByText(label) !== null && within(group).queryByText(item) !== null,
        );
      expect(groupHolding({ label: "QA Shared Team", item: "web-app" })).toBe(true);
      expect(groupHolding({ label: "Platform Team", item: "billing-svc" })).toBe(true);
      // A project whose team is not listed keeps the flat group.
      expect(groupHolding({ label: "Projects", item: "orphan-app" })).toBe(true);
    });
  });

  describe("given more than eight scopes", () => {
    function renderCrowdedPicker(onChange = vi.fn()) {
      renderPicker(
        <ScopeChipPicker
          value={[]}
          onChange={onChange}
          organizationId="org-1"
          organizationName="ACME Inc"
          availableTeams={teams}
          availableProjects={manyProjects}
        />,
      );
      return onChange;
    }

    /** @scenario A long scope list gets a search field */
    it("shows a search field that narrows by name and team", async () => {
      renderCrowdedPicker();
      const user = await openDropdown();

      await waitFor(() => {
        expect(screen.getByLabelText("Search scopes")).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Search scopes"), "platform");
      await waitFor(() => {
        expect(listbox().queryByText("qa-app-1")).not.toBeInTheDocument();
      });
      // Both Platform Team projects match through their team's name.
      expect(listbox().getByText("billing-svc")).toBeInTheDocument();
      expect(listbox().getByText("edge-router")).toBeInTheDocument();
      expect(listbox().queryByText("ACME Inc")).not.toBeInTheDocument();
    });

    /** @scenario Searching does not drop scopes already selected */
    it("keeps the selected scopes when a search picks another one", async () => {
      const onChange = vi.fn();
      renderPicker(
        <ScopeChipPicker
          value={[
            { scopeType: "PROJECT", scopeId: "p-qa-0" },
            { scopeType: "PROJECT", scopeId: "p-qa-1" },
          ]}
          onChange={onChange}
          organizationId="org-1"
          organizationName="ACME Inc"
          availableTeams={teams}
          availableProjects={manyProjects}
        />,
      );
      const user = await openDropdown();

      await user.type(screen.getByLabelText("Search scopes"), "billing");
      await waitFor(() => {
        expect(listbox().queryByText("qa-app-2")).not.toBeInTheDocument();
      });
      await user.click(listbox().getByText("billing-svc"));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalled();
      });
      const next = onChange.mock.calls.at(-1)?.[0];
      expect(next).toEqual(
        expect.arrayContaining([
          { scopeType: "PROJECT", scopeId: "p-qa-0" },
          { scopeType: "PROJECT", scopeId: "p-qa-1" },
          { scopeType: "PROJECT", scopeId: "p-bill" },
        ]),
      );
    });
  });

  describe("given the single-select variant with more than eight scopes", () => {
    /** @scenario The single-select dropdown searches the same way */
    it("narrows by team name and takes the picked project", async () => {
      const onChange = vi.fn();
      renderPicker(
        <ScopeChipPicker
          variant="single-select"
          value={[]}
          onChange={onChange}
          organizationId="org-1"
          organizationName="ACME Inc"
          availableTeams={teams}
          availableProjects={manyProjects}
          placeholder="Select a project"
        />,
      );
      const user = await openDropdown();

      await user.type(screen.getByLabelText("Search scopes"), "platform");
      await waitFor(() => {
        expect(listbox().queryByText("qa-app-1")).not.toBeInTheDocument();
      });
      // Both of the team's projects match through the team's name, and
      // they stay under a group header carrying it.
      expect(listbox().getByText("edge-router")).toBeInTheDocument();
      expect(
        listbox()
          .getAllByRole("group")
          .some(
            (group) =>
              within(group).queryByText("Platform Team") !== null &&
              within(group).queryByText("billing-svc") !== null,
          ),
      ).toBe(true);

      await user.click(listbox().getByText("billing-svc"));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith([{ scopeType: "PROJECT", scopeId: "p-bill" }]);
      });
    });
  });

  describe("given eight scopes or fewer", () => {
    /** @scenario A short scope list has no search field */
    it("offers no search field", async () => {
      renderPicker(
        <ScopeChipPicker
          value={[]}
          onChange={vi.fn()}
          organizationId="org-1"
          organizationName="ACME Inc"
          availableTeams={teams}
          availableProjects={[{ id: "p-web", name: "web-app", teamId: "t-acme" }]}
        />,
      );
      await openDropdown();

      await waitFor(() => {
        expect(listbox().getByText("web-app")).toBeInTheDocument();
      });
      expect(screen.queryByLabelText("Search scopes")).not.toBeInTheDocument();
    });
  });
});
