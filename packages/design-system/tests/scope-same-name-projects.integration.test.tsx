/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScopeChipPicker } from "../src/components/scope/scope-chip-picker.tsx";
import { ScopeFilter, type ScopeFilterValue } from "../src/components/scope/scope-filter.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const LONG_TEAM = "Applied Research and Evaluation Infrastructure Working Group";

const AVAILABLE = {
  organization: { id: "org_1", name: "ACME" },
  teams: [
    { id: "team_platform", name: "Platform" },
    { id: "team_research", name: "Research" },
    { id: "team_alex", name: "Alex Rivera's Workspace" },
    { id: "team_sam", name: "Sam Lee's Workspace" },
  ],
  projects: [
    { id: "p_web", name: "Web App", teamId: "team_platform" },
    { id: "p_eval_platform", name: "Eval Harness", teamId: "team_platform" },
    { id: "p_eval_research", name: "Eval Harness", teamId: "team_research" },
    {
      id: "p_alex",
      name: "Personal Workspace",
      teamId: "team_alex",
      hint: "Alex Rivera (you)",
    },
    { id: "p_sam", name: "Personal Workspace", teamId: "team_sam", hint: "Sam Lee" },
  ],
};

afterEach(cleanup);

type User = ReturnType<typeof userEvent.setup>;

function mountFilter({
  available = AVAILABLE,
  onChange = () => undefined,
}: {
  available?: typeof AVAILABLE;
  onChange?: (next: ScopeFilterValue) => void;
} = {}) {
  const user = userEvent.setup();
  renderWithDesignSystem(
    <ScopeFilter
      value={{ kind: "all" }}
      onChange={onChange}
      available={available}
      currentTeamId="team_platform"
      currentProjectId="p_web"
    />,
  );
  return user;
}

async function openProjectSubmenu({ user }: { user: User }) {
  await user.click(screen.getByTestId("scope-filter"));
  await user.click(await screen.findByTestId("filter-project-submenu"));
  return screen.findByTestId("filter-project-search");
}

async function openMoreScopes({ user }: { user: User }) {
  await user.click(screen.getByTestId("scope-filter"));
  await user.click(await screen.findByTestId("filter-more-scopes"));
  return screen.findByTestId("filter-more-search");
}

function badgeIn(element: HTMLElement) {
  return within(element).queryByTestId("scope-name-badge");
}

describe("given projects that share a name in the scope filter", () => {
  describe("when the project submenu is opened", () => {
    /** @scenario Same-name projects in different teams name their team in a badge */
    it("badges each same-name project with its team", async () => {
      const user = mountFilter();
      await openProjectSubmenu({ user });

      expect(
        badgeIn(screen.getByTestId("filter-project-option-p_eval_platform")),
      ).toHaveTextContent("Platform");
      expect(
        badgeIn(screen.getByTestId("filter-project-option-p_eval_research")),
      ).toHaveTextContent("Research");
    });

    /** @scenario A project with a unique name shows no badge */
    it("leaves a unique name without a badge", async () => {
      const user = mountFilter();
      await openProjectSubmenu({ user });

      expect(badgeIn(screen.getByTestId("filter-project-option-p_web"))).toBeNull();
    });

    /** @scenario A personal workspace names its owner, and the reader's own says "(you)" */
    it("badges personal workspaces with their owners", async () => {
      const user = mountFilter();
      await openProjectSubmenu({ user });

      expect(badgeIn(screen.getByTestId("filter-project-option-p_alex"))).toHaveTextContent(
        "Alex Rivera (you)",
      );
      expect(badgeIn(screen.getByTestId("filter-project-option-p_sam"))).toHaveTextContent(
        "Sam Lee",
      );
    });

    /** @scenario A screen reader hears the name and then the badge */
    it("names the row by its project and then its badge", async () => {
      const user = mountFilter();
      await openProjectSubmenu({ user });

      expect(screen.getByRole("menuitem", { name: "Eval Harness, Research" })).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Personal Workspace, Sam Lee" }),
      ).toBeInTheDocument();
    });

    /** @scenario Searching finds a project by its team or owner name */
    it("finds a project by its team or owner name", async () => {
      const user = mountFilter();
      const search = await openProjectSubmenu({ user });

      await user.type(search, "research");
      expect(screen.getByTestId("filter-project-option-p_eval_research")).toBeInTheDocument();
      expect(screen.queryByTestId("filter-project-option-p_eval_platform")).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "sam");
      expect(screen.getByTestId("filter-project-option-p_sam")).toBeInTheDocument();
      expect(screen.queryByTestId("filter-project-option-p_alex")).not.toBeInTheDocument();
    });
  });

  describe("when More Scopes is opened", () => {
    /** @scenario Same-name projects in different teams name their team in a badge */
    it("badges each same-name project with its team", async () => {
      const user = mountFilter();
      await openMoreScopes({ user });

      const rows = screen.getAllByTestId("filter-scope-project-eval harness");
      expect(rows.map((row) => badgeIn(row)?.textContent)).toEqual(["Platform", "Research"]);
      expect(badgeIn(screen.getByTestId("filter-scope-project-web app"))).toBeNull();
    });

    /** @scenario Enter after a search picks the first same-name match, not its namesake */
    it("picks the first same-name project on Enter", async () => {
      const picked: ScopeFilterValue[] = [];
      const user = mountFilter({ onChange: (next) => picked.push(next) });
      await openMoreScopes({ user });

      await user.keyboard("eval harness{Enter}");

      expect(picked).toEqual([
        {
          kind: "specific",
          scopeType: "PROJECT",
          scopeId: "p_eval_platform",
          name: "Eval Harness",
        },
      ]);
    });

    /** @scenario Searching finds a project by its team or owner name */
    it("finds a personal workspace by its owner", async () => {
      const user = mountFilter();
      await openMoreScopes({ user });

      await user.keyboard("sam");

      const rows = screen.getAllByTestId("filter-scope-project-personal workspace");
      expect(rows).toHaveLength(1);
      expect(badgeIn(rows[0]!)).toHaveTextContent("Sam Lee");
    });
  });

  describe("when a same-name project's team has a long name", () => {
    /** @scenario A long badge truncates and shows its whole text on hover */
    it("truncates the badge and keeps the whole name on hover", async () => {
      const user = mountFilter({
        available: {
          ...AVAILABLE,
          teams: [...AVAILABLE.teams, { id: "team_long", name: LONG_TEAM }],
          projects: [
            ...AVAILABLE.projects,
            { id: "p_eval_long", name: "Eval Harness", teamId: "team_long" },
          ],
        },
      });
      await openProjectSubmenu({ user });

      const badge = badgeIn(screen.getByTestId("filter-project-option-p_eval_long"));
      expect(badge).toHaveAttribute("title", LONG_TEAM);
      expect(badge?.querySelector("span")).toHaveStyle({ textOverflow: "ellipsis" });
    });
  });
});

describe("given projects that share a name in the scope chip picker", () => {
  function listbox() {
    return within(screen.getByRole("listbox"));
  }

  function optionNamed(name: string) {
    return listbox().getByRole("option", { name });
  }

  /** @scenario Same-name projects in different teams name their team in a badge */
  it("badges same-name projects and leaves a unique one plain", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(
      <ScopeChipPicker
        value={[]}
        onChange={vi.fn()}
        organizationId="org_1"
        organizationName="ACME"
        availableTeams={AVAILABLE.teams}
        availableProjects={AVAILABLE.projects}
      />,
    );
    await user.click(screen.getByRole("combobox"));

    expect(badgeIn(optionNamed("Eval Harness, Platform"))).toHaveTextContent("Platform");
    expect(badgeIn(optionNamed("Eval Harness, Research"))).toHaveTextContent("Research");
    expect(badgeIn(optionNamed("Personal Workspace, Alex Rivera (you)"))).toHaveTextContent(
      "Alex Rivera (you)",
    );
    expect(badgeIn(optionNamed("Web App"))).toBeNull();
  });

  /** @scenario Searching finds a project by its team or owner name */
  /** @scenario A search with a space in it keeps the dropdown open */
  it("finds a personal workspace by its owner's name and picks it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithDesignSystem(
      <ScopeChipPicker
        variant="single-select"
        value={[]}
        onChange={onChange}
        organizationId="org_1"
        organizationName="ACME"
        availableTeams={AVAILABLE.teams}
        availableProjects={AVAILABLE.projects}
        placeholder="Select a scope"
      />,
    );
    await user.click(screen.getByRole("combobox"));

    await user.type(screen.getByLabelText("Search scopes"), "alex rivera (you)");
    await waitFor(() => expect(listbox().getAllByRole("option")).toHaveLength(1));
    await user.click(optionNamed("Personal Workspace, Alex Rivera (you)"));

    expect(onChange).toHaveBeenLastCalledWith([{ scopeType: "PROJECT", scopeId: "p_alex" }]);
  });
});
