/** @vitest-environment jsdom */
// Read-side scope filter: one option list for every page, reachable by keyboard.
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ScopeFilter, type ScopeFilterValue } from "../src/components/scope/scope-filter.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

const AVAILABLE = {
  organization: { id: "org_1", name: "ACME" },
  teams: [{ id: "team_1", name: "Platform" }],
  projects: [{ id: "project_1", name: "Web App", teamId: "team_1" }],
};

describe("given the scope filter", () => {
  describe("when its options are opened", () => {
    /** @scenario Scope filter dropdown offers the same options as the model-providers page */
    it("offers everything the caller can see, from the one list every page passes it", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "all" }}
          onChange={() => undefined}
          available={AVAILABLE}
          currentTeamId="team_1"
          currentProjectId="project_1"
        />,
      );

      await user.click(screen.getByTestId("scope-filter"));
      // The named scopes live one level down, behind "More Scopes" — the two
      // ambient picks and "All you can see" are the top level.
      expect(await screen.findByTestId("filter-all")).toBeDefined();
      expect(screen.getByTestId("filter-this-team")).toBeDefined();
      expect(screen.getByTestId("filter-this-project")).toBeDefined();
      await user.click(screen.getByTestId("filter-more-scopes"));

      // One surface, one option list: the API Keys page and the model-providers
      // page pass the same three-field shape and therefore see the same menu.
      expect(await screen.findByTestId("filter-scope-organization-acme")).toBeDefined();
      expect(screen.getByTestId("filter-scope-team-platform")).toBeDefined();
      expect(screen.getByTestId("filter-scope-project-web app")).toBeDefined();
    });

    /** @scenario The ambient team and project options name the team and project they follow */
    it("names the team and project the ambient options follow", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "all" }}
          onChange={() => undefined}
          available={AVAILABLE}
          currentTeamId="team_1"
          currentProjectId="project_1"
        />,
      );

      await user.click(screen.getByTestId("scope-filter"));

      const team = await screen.findByTestId("filter-this-team");
      const project = screen.getByTestId("filter-this-project");
      expect(team).toHaveTextContent(/^Team Platform$/);
      expect(project).toHaveTextContent(/^Project Web App$/);
      expect(within(team).getByTestId("scope-name-badge")).toHaveTextContent(/^Platform$/);
      expect(within(project).getByTestId("scope-name-badge")).toHaveTextContent(/^Web App$/);
      expect(screen.getByRole("menuitem", { name: "Team Platform" })).toBe(team);
    });

    /** @scenario The ambient team and project options name the team and project they follow */
    it("names the followed team in the trigger once it is the filter", () => {
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "team-current" }}
          onChange={() => undefined}
          available={AVAILABLE}
          currentTeamId="team_1"
          currentProjectId="project_1"
        />,
      );

      const trigger = screen.getByTestId("scope-filter");
      expect(trigger).toHaveTextContent(/^Team Platform$/);
      expect(within(trigger).getByTestId("scope-name-badge")).toHaveTextContent(/^Platform$/);
    });

    /** @scenario An ambient option whose name is unknown keeps its plain label */
    it("keeps the plain labels when the current team and project are not listed", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "all" }}
          onChange={() => undefined}
          available={{ organization: AVAILABLE.organization, teams: [], projects: [] }}
          currentTeamId="team_9"
          currentProjectId="project_9"
        />,
      );

      await user.click(screen.getByTestId("scope-filter"));

      expect(await screen.findByTestId("filter-this-team")).toHaveTextContent(/^This Team$/);
      expect(screen.getByTestId("filter-this-project")).toHaveTextContent(/^This Project$/);
      expect(screen.queryByTestId("scope-name-badge")).toBeNull();
    });

    /** @scenario Scope filter dropdown is keyboard navigable */
    it("is a menu, so arrow keys and Enter reach every option", async () => {
      const user = userEvent.setup();
      const picked: unknown[] = [];
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "all" }}
          onChange={(next) => picked.push(next)}
          available={AVAILABLE}
          currentTeamId="team_1"
          currentProjectId="project_1"
        />,
      );

      // Keyboard navigation is Ark's, provided by the Menu this is built from —
      // which is exactly why the platform guard asserted the component USED a
      // Menu. Driving it is stronger: the trigger takes focus, opens on Enter,
      // and the highlighted option is chosen without a pointer ever moving.
      await user.tab();
      expect(screen.getByTestId("scope-filter")).toHaveFocus();
      await user.keyboard("{Enter}");

      // Opening it with the keyboard is the half that has to be a Menu; the
      // options are then reachable because Ark manages the highlight for them.
      const options = await screen.findAllByRole("menuitem");
      expect(options.length).toBeGreaterThan(1);

      await user.keyboard("{ArrowDown}");
      await user.keyboard("{Enter}");
      expect(picked.length).toBeGreaterThan(0);
    });
  });

  describe("when the reader can see projects other than the current one", () => {
    const MANY_PROJECTS = {
      ...AVAILABLE,
      projects: [
        { id: "project_1", name: "Web App", teamId: "team_1" },
        { id: "project_2", name: "Billing API", teamId: "team_1" },
        { id: "project_3", name: "Support Bot", teamId: "team_1" },
      ],
    };

    function mount({ currentProjectId = "project_1" }: { currentProjectId?: string | null } = {}) {
      const picked: ScopeFilterValue[] = [];
      const user = userEvent.setup();
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "all" }}
          onChange={(next) => picked.push(next)}
          available={MANY_PROJECTS}
          currentTeamId="team_1"
          currentProjectId={currentProjectId}
        />,
      );
      return { user, picked };
    }

    type User = ReturnType<typeof userEvent.setup>;

    async function openMenu({ user }: { user: User }) {
      await user.click(screen.getByTestId("scope-filter"));
      return screen.findByTestId("filter-project-submenu");
    }

    async function openProjectSubmenu({ user }: { user: User }) {
      await user.click(await openMenu({ user }));
      return screen.findByTestId("filter-project-search");
    }

    /** @scenario This Project opens a submenu headed by the current project */
    it("heads the submenu with This project, then the search, then every project, current first", async () => {
      const { user, picked } = mount();

      const submenu = await openMenu({ user });
      expect(submenu).toHaveTextContent(/^Project Web App$/);
      expect(screen.queryByTestId("filter-this-project")).not.toBeInTheDocument();
      await user.click(submenu);
      await screen.findByTestId("filter-project-search");

      const items = screen
        .getAllByRole("menuitem")
        .map((item) => item.getAttribute("data-testid"))
        .filter(
          (testId) =>
            testId?.startsWith("filter-project-option-") || testId === "filter-this-project",
        );
      expect(items).toEqual([
        "filter-this-project",
        "filter-project-option-project_1",
        "filter-project-option-project_2",
        "filter-project-option-project_3",
      ]);
      expect(screen.getByTestId("filter-this-project")).toHaveTextContent(/^Project Web App$/);
      expect(screen.getByTestId("filter-project-option-project_1")).toHaveTextContent(
        "Web AppCurrent",
      );
      expect(screen.getByTestId("filter-project-option-project_2")).not.toHaveTextContent(
        "Current",
      );

      await user.click(screen.getByTestId("filter-this-project"));
      expect(picked).toEqual([{ kind: "project-current" }]);
    });

    /** @scenario The project search finds the current project */
    it("finds the current project by name and marks it Current", async () => {
      const { user } = mount();
      const search = await openProjectSubmenu({ user });

      await user.click(search);
      await user.keyboard("web");

      expect(screen.getByTestId("filter-project-option-project_1")).toHaveTextContent("Current");
      expect(screen.queryByTestId("filter-project-option-project_2")).not.toBeInTheDocument();
      expect(screen.queryByTestId("filter-project-search-empty")).not.toBeInTheDocument();
    });

    /** @scenario The project search box is the shared search field */
    it("draws the search box with the shared search field, icon inside the input", async () => {
      const { user } = mount();
      const search = await openProjectSubmenu({ user });

      // The shared field is a searchbox wrapping its own decorative icon, so a
      // hand-rolled icon beside a plain input would fail both halves.
      expect(search).toHaveAttribute("type", "search");
      expect(screen.getByRole("searchbox")).toBe(search);
      expect(search.closest("div")?.querySelector("svg[aria-hidden='true']")).toBeTruthy();
    });

    /** @scenario Typing in the project search narrows the list by name */
    it("narrows the list by name, ignoring case, and keeps the menu and focus", async () => {
      const { user } = mount();
      const search = await openProjectSubmenu({ user });

      await user.click(search);
      await user.keyboard("bILL");

      expect(search).toHaveFocus();
      expect(search).toHaveValue("bILL");
      expect(screen.getByTestId("filter-project-option-project_2")).toBeInTheDocument();
      expect(screen.queryByTestId("filter-project-option-project_3")).not.toBeInTheDocument();
      expect(screen.getByTestId("filter-this-project")).toBeInTheDocument();
    });

    /** @scenario Typing in the project search narrows the list by name */
    it("keeps Space and the left arrow as text editing, not as menu commands", async () => {
      const { user, picked } = mount();
      const search = await openProjectSubmenu({ user });

      await user.click(search);
      await user.keyboard("support bot{ArrowLeft}");

      expect(search).toHaveValue("support bot");
      expect(search).toHaveFocus();
      expect(picked).toEqual([]);
    });

    /** @scenario Typing in the project search narrows the list by name */
    it("sends typing anywhere in the submenu to the search box, not to typeahead", async () => {
      const { user } = mount();
      const search = await openProjectSubmenu({ user });
      // The submenu takes focus a frame after it opens; type only once it has.
      await waitFor(() => expect(search.closest("[role=menu]")).toHaveFocus());

      await user.keyboard("sup");

      expect(search).toHaveFocus();
      expect(search).toHaveValue("sup");
      expect(screen.getByTestId("filter-project-option-project_3")).toBeInTheDocument();
      expect(screen.queryByTestId("filter-project-option-project_2")).not.toBeInTheDocument();
    });

    /** @scenario The project search keeps the menu keyboard controls */
    it("highlights the first match for Enter, moves with arrows and closes on Escape", async () => {
      const { user, picked } = mount();
      const search = await openProjectSubmenu({ user });

      await user.click(search);
      await user.keyboard("o");
      // "o" matches Support Bot only: Web App and Billing API have no "o".
      await waitFor(() =>
        expect(screen.getByTestId("filter-project-option-project_3")).toHaveAttribute(
          "data-highlighted",
        ),
      );

      await user.keyboard("{ArrowUp}");
      expect(search).toHaveFocus();
      await waitFor(() =>
        expect(screen.getByTestId("filter-this-project")).toHaveAttribute("data-highlighted"),
      );
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{Enter}");
      expect(picked).toEqual([
        { kind: "specific", scopeType: "PROJECT", scopeId: "project_3", name: "Support Bot" },
      ]);
    });

    /** @scenario The project search keeps the menu keyboard controls */
    it("closes the menu on Escape without picking anything", async () => {
      const { user, picked } = mount();
      const search = await openProjectSubmenu({ user });

      await user.click(search);
      await user.keyboard("bill{Escape}");

      await waitFor(() =>
        expect(screen.queryByTestId("filter-project-search")).not.toBeInTheDocument(),
      );
      // The submenu unmounting only proves the child closed, so pin an item of
      // the root menu too.
      expect(screen.queryByTestId("filter-all")).not.toBeInTheDocument();
      expect(screen.queryByTestId("filter-more-scopes")).not.toBeInTheDocument();
      expect(picked).toEqual([]);
    });

    /** @scenario A project search with no matches says so */
    it("says no project matches, and still offers This Project", async () => {
      const { user } = mount();
      const search = await openProjectSubmenu({ user });

      await user.click(search);
      await user.keyboard("zzz");

      expect(screen.getByTestId("filter-project-search-empty")).toHaveTextContent(
        "No projects match",
      );
      expect(screen.queryByTestId(/^filter-project-option-/)).not.toBeInTheDocument();
      expect(screen.getByTestId("filter-this-project")).toBeInTheDocument();
    });

    /** @scenario Reopening the project submenu starts from an empty search */
    it("empties the search and relists every project when the submenu is reopened", async () => {
      const { user } = mount();
      const search = await openProjectSubmenu({ user });

      await user.click(search);
      await user.keyboard("bill");
      expect(screen.queryByTestId("filter-project-option-project_3")).not.toBeInTheDocument();

      // Close the submenu only: the parent menu stays open, so the submenu's
      // state survives and a stale query would come back with it. Escaping the
      // whole menu would unmount the component and pass either way.
      await user.hover(screen.getByTestId("filter-all"));
      await waitFor(() =>
        expect(screen.queryByTestId("filter-project-search")).not.toBeInTheDocument(),
      );
      await user.click(screen.getByTestId("filter-project-submenu"));

      const reopened = await screen.findByTestId("filter-project-search");
      expect(reopened).toHaveValue("");
      for (const id of ["project_1", "project_2", "project_3"]) {
        expect(screen.getByTestId(`filter-project-option-${id}`)).toBeInTheDocument();
      }
    });

    /** @scenario Picking another project from the submenu filters to that project */
    it("picks the specific project, which the trigger then names", async () => {
      const { user, picked } = mount();
      await openProjectSubmenu({ user });

      await user.click(screen.getByTestId("filter-project-option-project_2"));

      expect(picked).toEqual([
        { kind: "specific", scopeType: "PROJECT", scopeId: "project_2", name: "Billing API" },
      ]);
      cleanup();
      renderWithDesignSystem(
        <ScopeFilter
          value={picked[0]!}
          onChange={() => undefined}
          available={MANY_PROJECTS}
          currentProjectId="project_1"
        />,
      );
      const trigger = screen.getByTestId("scope-filter");
      expect(trigger).toHaveTextContent(/^Project Billing API$/);
      expect(within(trigger).getByTestId("scope-name-badge")).toHaveTextContent(/^Billing API$/);
    });

    /** @scenario Without a current project the submenu is named Projects */
    it("names the submenu Projects and lists every project, with no This Project entry", async () => {
      const { user } = mount({ currentProjectId: null });
      const submenu = await openMenu({ user });
      expect(submenu).toHaveTextContent("Projects");
      await user.click(submenu);
      await screen.findByTestId("filter-project-search");

      expect(screen.queryByTestId("filter-this-project")).not.toBeInTheDocument();
      for (const id of ["project_1", "project_2", "project_3"]) {
        expect(screen.getByTestId(`filter-project-option-${id}`)).toBeInTheDocument();
      }
    });
  });

  describe("when More Scopes is opened", () => {
    const SCOPES = {
      organization: { id: "org_1", name: "ACME" },
      teams: [
        { id: "team_1", name: "Platform" },
        { id: "team_2", name: "Research" },
      ],
      projects: [
        { id: "project_1", name: "Web App", teamId: "team_1" },
        { id: "project_2", name: "Research Notebook", teamId: "team_2" },
      ],
    };

    async function openMore({
      onChange = () => undefined,
    }: { onChange?: (next: ScopeFilterValue) => void } = {}) {
      const user = userEvent.setup();
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "all" }}
          onChange={onChange}
          available={SCOPES}
          currentTeamId="team_1"
          currentProjectId="project_1"
        />,
      );
      await user.click(screen.getByTestId("scope-filter"));
      await user.click(await screen.findByTestId("filter-more-scopes"));
      return { user, search: await screen.findByTestId("filter-more-search") };
    }

    /** @scenario More Scopes has the shared search field, narrowing every scope by name */
    it("narrows the organization, teams and projects by name, ignoring case", async () => {
      const { user, search } = await openMore();
      expect(search).toHaveAttribute("type", "search");
      expect(search.closest("div")?.querySelector("svg[aria-hidden='true']")).toBeTruthy();
      expect(search).toHaveFocus();

      await user.keyboard("rESEARCH");

      expect(search).toHaveFocus();
      expect(search).toHaveValue("rESEARCH");
      expect(screen.getByTestId("filter-scope-team-research")).toBeInTheDocument();
      expect(screen.getByTestId("filter-scope-project-research notebook")).toBeInTheDocument();
      expect(screen.queryByTestId("filter-scope-organization-acme")).not.toBeInTheDocument();
      expect(screen.queryByTestId("filter-scope-team-platform")).not.toBeInTheDocument();
      expect(screen.queryByTestId("filter-scope-project-web app")).not.toBeInTheDocument();
    });

    /** @scenario A More Scopes search picks its first match on Enter */
    it("highlights the first match as you type, so Enter picks it", async () => {
      const picked: ScopeFilterValue[] = [];
      const { user } = await openMore({ onChange: (next) => picked.push(next) });

      await user.keyboard("research{Enter}");

      expect(picked).toEqual([
        { kind: "specific", scopeType: "TEAM", scopeId: "team_2", name: "Research" },
      ]);
    });

    /** @scenario A More Scopes search with no matches says so */
    it("says no scope matches", async () => {
      const { user, search } = await openMore();

      await user.click(search);
      await user.keyboard("zzz");

      expect(screen.getByTestId("filter-more-search-empty")).toHaveTextContent("No scopes match");
      expect(screen.queryByTestId(/^filter-scope-/)).not.toBeInTheDocument();
    });

    /** @scenario Reopening the scope filter starts More Scopes from an empty search */
    it("empties the search when the scope filter is closed and reopened", async () => {
      const { user, search } = await openMore();
      await user.click(search);
      await user.keyboard("acme{Escape}");
      await waitFor(() =>
        expect(screen.queryByTestId("filter-more-scopes")).not.toBeInTheDocument(),
      );

      await user.click(screen.getByTestId("scope-filter"));
      const reopened = await screen.findByTestId("filter-more-search");
      expect(reopened).toHaveValue("");
      expect(screen.getByTestId("filter-scope-team-platform")).toBeInTheDocument();
    });
  });

  describe("when the current project is the only one the reader can see", () => {
    /** @scenario With no other project to pick, This Project stays a plain option */
    it("keeps This Project as a one-click option with no submenu", async () => {
      const user = userEvent.setup();
      const picked: ScopeFilterValue[] = [];
      renderWithDesignSystem(
        <ScopeFilter
          value={{ kind: "all" }}
          onChange={(next) => picked.push(next)}
          available={AVAILABLE}
          currentTeamId="team_1"
          currentProjectId="project_1"
        />,
      );

      await user.click(screen.getByTestId("scope-filter"));
      await user.click(await screen.findByTestId("filter-this-project"));

      expect(screen.queryByTestId("filter-project-submenu")).not.toBeInTheDocument();
      expect(picked).toEqual([{ kind: "project-current" }]);
    });
  });
});
