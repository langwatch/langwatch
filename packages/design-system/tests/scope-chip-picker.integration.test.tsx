/** @vitest-environment jsdom */
// Guards quick-picks against bypassing allowedScopeTypes.
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collapseRedundantScopes,
  ScopeChipPicker,
} from "../src/components/scope/scope-chip-picker.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

describe("ScopeChipPicker quick-picks", () => {
  afterEach(cleanup);

  describe("given allowedScopeTypes restricts to org + department", () => {
    it("omits the team and project quick-picks even when their ids are set", () => {
      renderWithDesignSystem(
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
      renderWithDesignSystem(
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
        renderWithDesignSystem(
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
        renderWithDesignSystem(
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
      renderWithDesignSystem(
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
      renderWithDesignSystem(
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
      renderWithDesignSystem(
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
      renderWithDesignSystem(
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
      renderWithDesignSystem(
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
      renderWithDesignSystem(
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
      renderWithDesignSystem(
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
      renderWithDesignSystem(
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

describe("ScopeChipPicker summary line", () => {
  afterEach(cleanup);

  const renderWith = ({
    scope,
    subjectNoun,
    named = true,
  }: {
    scope: { scopeType: "TEAM" | "PROJECT"; scopeId: string };
    subjectNoun?: string;
    named?: boolean;
  }) =>
    renderWithDesignSystem(
      <ScopeChipPicker
        value={[scope]}
        onChange={vi.fn()}
        organizationId="org-1"
        availableTeams={named ? [{ id: "team-1", name: "Platform" }] : undefined}
        availableProjects={
          named ? [{ id: "proj-1", name: "Checkout", teamId: "team-1" }] : undefined
        }
        singleSelect
        subjectNoun={subjectNoun}
        currentOrganizationId="org-1"
        currentTeamId="team-1"
        currentProjectId="proj-1"
      />,
    );

  describe("given a picked project with a known name", () => {
    /** @scenario The helper under the picker names the scope it binds to */
    it("names the project, calling the scoped thing a configuration by default", () => {
      renderWith({ scope: { scopeType: "PROJECT", scopeId: "proj-1" } });

      const helper = screen.getByTestId("scope-summary");
      expect(helper).toHaveTextContent(/^Only Checkout can use this configuration\.$/);
      expect(within(helper).getByTestId("scope-name-badge")).toHaveTextContent(/^Checkout$/);
    });

    /** @scenario The helper under the picker names the scope it binds to */
    it("names the scoped thing with the subject noun", () => {
      renderWith({ scope: { scopeType: "PROJECT", scopeId: "proj-1" }, subjectNoun: "connection" });

      expect(screen.getByTestId("scope-summary")).toHaveTextContent(
        /^Only Checkout can use this connection\.$/,
      );
    });
  });

  describe("given a picked team with a known name", () => {
    /** @scenario The helper under the picker names the scope it binds to */
    it("names the team every project inherits from", () => {
      renderWith({ scope: { scopeType: "TEAM", scopeId: "team-1" } });

      const helper = screen.getByTestId("scope-summary");
      expect(helper).toHaveTextContent(/^Every project in Platform inherits this configuration\.$/);
      expect(within(helper).getByTestId("scope-name-badge")).toHaveTextContent(/^Platform$/);
    });
  });

  describe("given a picked project the picker has no name for", () => {
    /** @scenario The helper keeps its plain wording when the scope's name is unknown */
    it("keeps the plain wording", () => {
      renderWith({ scope: { scopeType: "PROJECT", scopeId: "proj-1" }, named: false });

      expect(screen.getByTestId("scope-summary")).toHaveTextContent(
        /^Only this project can use this configuration\.$/,
      );
      expect(screen.queryByTestId("scope-name-badge")).toBeNull();
    });
  });
});

describe("ScopeChipPicker quick picks name the current scope", () => {
  afterEach(cleanup);

  const renderPicks = ({
    teams,
    projects,
  }: {
    teams?: { id: string; name: string }[];
    projects?: { id: string; name: string; teamId?: string }[];
  }) =>
    renderWithDesignSystem(
      <ScopeChipPicker
        value={[{ scopeType: "PROJECT", scopeId: "proj-1" }]}
        onChange={vi.fn()}
        organizationId="org-1"
        availableTeams={teams}
        availableProjects={projects}
        showQuickPicks
        currentOrganizationId="org-1"
        currentTeamId="team-1"
        currentProjectId="proj-1"
      />,
    );

  /** The green name badge inside an element: the platform's own `Badge`, carrying the name. */
  const badgeIn = (element: HTMLElement) => within(element).getByTestId("scope-name-badge");

  describe("given the current team and project are among those it was given", () => {
    /** @scenario The quick picks name the current team and project */
    it("reads Team and Project, each followed by its name in a green badge", () => {
      renderPicks({
        teams: [{ id: "team-1", name: "Platform" }],
        projects: [{ id: "proj-1", name: "Checkout", teamId: "team-1" }],
      });

      const team = screen.getByTestId("quick-scope-team");
      const project = screen.getByTestId("quick-scope-project");
      expect(team).toHaveTextContent(/^Team Platform$/);
      expect(project).toHaveTextContent(/^Project Checkout$/);
      expect(badgeIn(team)).toHaveTextContent(/^Platform$/);
      expect(badgeIn(project)).toHaveTextContent(/^Checkout$/);
      expect(badgeIn(project)).toHaveClass("chakra-badge");
      expect(screen.getByTestId("quick-scope-organization")).toHaveTextContent(/^Organization$/);
    });

    /** @scenario The quick picks name the current team and project */
    it("gives each pick an accessible name that reads the kind, then the name", () => {
      renderPicks({
        teams: [{ id: "team-1", name: "Platform" }],
        projects: [{ id: "proj-1", name: "Checkout", teamId: "team-1" }],
      });

      expect(screen.getByRole("button", { name: "Team Platform" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Project Checkout" })).toBeInTheDocument();
    });
  });

  describe("given a current project whose name is long", () => {
    /** @scenario A long quick-pick name is truncated with the full label on hover */
    it("truncates the name inside the badge and carries the full name as its title", () => {
      const name = "Customer support evaluation harness for the enterprise tier";
      renderPicks({
        teams: [{ id: "team-1", name: "Platform" }],
        projects: [{ id: "proj-1", name, teamId: "team-1" }],
      });

      const badge = badgeIn(screen.getByTestId("quick-scope-project"));
      expect(badge).toHaveAttribute("title", name);
      expect(within(badge).getByText(name)).toHaveStyle({ textOverflow: "ellipsis" });
    });
  });

  describe("given the current team and project are not among those it was given", () => {
    /** @scenario A quick pick whose name is unknown keeps its plain label */
    it("keeps the plain This team and This project labels, with no badge", () => {
      renderPicks({ teams: [], projects: [] });

      expect(screen.getByTestId("quick-scope-team")).toHaveTextContent(/^This team$/);
      expect(screen.getByTestId("quick-scope-project")).toHaveTextContent(/^This project$/);
      expect(screen.queryByTestId("scope-name-badge")).toBeNull();
    });
  });
});

describe("given a selection that already names a team and a project", () => {
  describe("when the whole organization is then picked", () => {
    it("keeps the organization and drops what it already implies", () => {
      const previous = [
        { scopeType: "TEAM" as const, scopeId: "team_1" },
        { scopeType: "PROJECT" as const, scopeId: "project_1" },
      ];

      const collapsed = collapseRedundantScopes(
        [...previous, { scopeType: "ORGANIZATION", scopeId: "org_1" }],
        previous,
        {
          organizationId: "org_1",
          availableProjects: [{ id: "project_1", teamId: "team_1" }],
        },
      );

      expect(collapsed).toEqual([{ scopeType: "ORGANIZATION", scopeId: "org_1" }]);
    });
  });

  describe("when nothing new was picked", () => {
    it("leaves the selection exactly as it was", () => {
      const previous = [
        { scopeType: "TEAM" as const, scopeId: "team_1" },
        { scopeType: "PROJECT" as const, scopeId: "project_1" },
      ];

      expect(
        collapseRedundantScopes(previous, previous, {
          organizationId: "org_1",
          availableProjects: [{ id: "project_1", teamId: "team_1" }],
        }),
      ).toEqual(previous);
    });
  });
});
