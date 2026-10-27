/** @vitest-environment jsdom */
// Read-side scope filter: one option list for every page, reachable by keyboard.
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
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
      expect(await screen.findByText("ACME")).toBeDefined();
      expect(screen.getByText("Platform")).toBeDefined();
      expect(screen.getByText("Web App")).toBeDefined();
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
    it("heads the submenu with This Project, then the search, then every other project", async () => {
      const { user, picked } = mount();

      const submenu = await openMenu({ user });
      expect(submenu).toHaveTextContent("This Project");
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
        "filter-project-option-project_2",
        "filter-project-option-project_3",
      ]);

      await user.click(screen.getByTestId("filter-this-project"));
      expect(picked).toEqual([{ kind: "project-current" }]);
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
      // "o" matches Support Bot only among the other projects.
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
      expect(screen.getByTestId("scope-filter")).toHaveTextContent("Project: Billing API");
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
