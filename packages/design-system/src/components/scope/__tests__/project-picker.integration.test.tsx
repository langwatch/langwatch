// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { ProjectPicker, type ProjectPickerGroup } from "../project-picker.tsx";

afterEach(cleanup);

const GROUPS: ProjectPickerGroup[] = [
  {
    team: { teamId: "team-a", orgId: "org-1", label: "Platform", canCreateProject: true },
    projects: [
      { projectId: "web", label: "Web", href: "/web" },
      { projectId: "billing", label: "Billing sync", href: "/billing" },
    ],
  },
  {
    team: { teamId: "team-b", orgId: "org-1", label: "Growth" },
    projects: [{ projectId: "all", label: "Everything", href: "/all", isAggregate: true }],
  },
];

function renderPicker() {
  const onOpenProject = vi.fn();
  const onCreateProjectForTeam = vi.fn();
  renderWithDesignSystem(
    <ProjectPicker
      groups={GROUPS}
      currentProjectId="web"
      currentProjectName="Web"
      showTeamHeaders
      onOpenProject={onOpenProject}
      onCreateProjectForTeam={onCreateProjectForTeam}
    />,
  );
  return { onOpenProject, onCreateProjectForTeam };
}

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Switch project" }));
  const field = screen.getByRole("combobox", { name: "Search projects" });
  await waitFor(() => expect(field).toHaveFocus());
  return { user, field };
}

function searchFor(text: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Search projects" }), {
    target: { value: text },
  });
}

describe("ProjectPicker", () => {
  describe("given a long current project name", () => {
    it("bounds the chip and names the project in full on hover", () => {
      const name = "Customer support assistant for the European billing desk";
      renderWithDesignSystem(
        <ProjectPicker
          groups={GROUPS}
          currentProjectId="web"
          currentProjectName={name}
          showTeamHeaders
          onOpenProject={vi.fn()}
        />,
      );

      expect(screen.getByRole("button", { name: "Switch project" })).toHaveStyle({
        maxWidth: "260px",
      });
      expect(screen.getByTitle(name)).toHaveTextContent(name);
    });
  });

  describe("when opened", () => {
    it("offers a per-team New Project while the list is unfiltered", async () => {
      const { onCreateProjectForTeam } = renderPicker();
      const { user } = await open();

      await user.click(screen.getByRole("option", { name: /New Project/ }));

      expect(onCreateProjectForTeam).toHaveBeenCalledWith({ teamId: "team-a", orgId: "org-1" });
    });
  });

  describe("when the reader types", () => {
    /** @scenario "Typing filters the projects and Enter switches to the first match" */
    it("matches team names too, and hides the create entries", async () => {
      renderPicker();
      await open();

      searchFor("growth");

      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
      expect(screen.getByRole("option", { name: /Everything/ })).toBeInTheDocument();
      expect(screen.queryByText("New Project")).not.toBeInTheDocument();
    });
  });

  describe("when the reader uses the keyboard", () => {
    /** @scenario "The picker answers the keyboard alone" */
    it("moves with the arrows and opens the highlighted project on Enter", async () => {
      const { onOpenProject } = renderPicker();
      const { user } = await open();

      searchFor("billing");
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
      await user.keyboard("{ArrowDown}{Enter}");

      await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("/billing"));
    });

    /** @scenario "The picker answers the keyboard alone" */
    it("clears the search on the first Escape and closes on the second", async () => {
      renderPicker();
      const { field } = await open();

      searchFor("billing");
      await waitFor(() => expect(field).toHaveValue("billing"));
      fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
      await waitFor(() => expect(field).toHaveValue(""));

      fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
      await waitFor(() => expect(field).not.toBeVisible());
    });
  });
});
