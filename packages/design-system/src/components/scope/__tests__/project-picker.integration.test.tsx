// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { ProjectPicker, type ProjectPickerGroup } from "../project-picker.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const WEB_ID = "project_0000aBcDeFgHiJH1Ziwj";
const BILLING_ID = "project_0000kLmNoPqRsTSr4Pwe";

const GROUPS: ProjectPickerGroup[] = [
  {
    team: { teamId: "team-a", orgId: "org-1", label: "Platform", canCreateProject: true },
    projects: [
      { projectId: WEB_ID, label: "Web", href: "/web" },
      { projectId: BILLING_ID, label: "Billing sync", href: "/billing" },
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
      currentProjectId={WEB_ID}
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
          currentProjectId={WEB_ID}
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

  describe("when the reader points at a project", () => {
    /** @scenario "At rest the picker shows no project IDs" */
    it("shows no ID until a row is pointed at, the current project ticked", async () => {
      renderPicker();
      await open();

      expect(screen.getByLabelText("Current project")).toBeInTheDocument();
      expect(screen.queryByText(WEB_ID)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Copy the ID of/ })).not.toBeInTheDocument();
    });

    /** @scenario "Hovering the current project shows its ID in place of the tick" */
    it("swaps the current project's tick for its ID, named in full on hover", async () => {
      renderPicker();
      const { user } = await open();

      await user.hover(screen.getByRole("option", { name: /Web/ }));

      expect(await screen.findByTitle(WEB_ID)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy the ID of Web" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Current project")).not.toBeInTheDocument();
    });

    /** @scenario "Hovering another project shows that project's ID" */
    it("shows another project's ID and keeps the current project's tick", async () => {
      renderPicker();
      const { user } = await open();

      await user.hover(screen.getByRole("option", { name: /Billing sync/ }));

      expect(await screen.findByTitle(BILLING_ID)).toBeInTheDocument();
      expect(screen.getByLabelText("Current project")).toBeInTheDocument();
      expect(screen.queryByTitle(WEB_ID)).not.toBeInTheDocument();
    });

    /** @scenario "Copying a project's ID keeps me on my project with the picker open" */
    it("copies the full ID, says Copied, and switches nothing", async () => {
      const { onOpenProject } = renderPicker();
      const { user, field } = await open();

      await user.hover(screen.getByRole("option", { name: /Billing sync/ }));
      await user.click(await screen.findByRole("button", { name: "Copy the ID of Billing sync" }));

      await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(BILLING_ID));
      expect((await screen.findAllByText("Copied")).length).toBeGreaterThan(0);
      expect(onOpenProject).not.toHaveBeenCalled();
      expect(field).toBeVisible();
    });

    /** @scenario "Hovering the copy button names what it does" */
    it("labels the copy button Copy project ID, then Copied after the click", async () => {
      renderPicker();
      const { user } = await open();

      await user.hover(screen.getByRole("option", { name: /Billing sync/ }));
      const button = await screen.findByRole("button", { name: "Copy the ID of Billing sync" });
      await user.hover(button);

      expect(await screen.findByRole("tooltip")).toHaveTextContent("Copy project ID");
      await user.click(button);
      await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("Copied"));
    });

    /** @scenario "Clicking the rest of a row still switches project" */
    it("opens the project when the row itself is clicked", async () => {
      const { onOpenProject } = renderPicker();
      const { user } = await open();

      await user.hover(screen.getByRole("option", { name: /Billing sync/ }));
      await user.click(screen.getByText("Billing sync"));

      await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("/billing"));
    });

    /** @scenario "The browser refuses the clipboard" */
    it("says the copy failed when the clipboard is refused, and switches nothing", async () => {
      const { onOpenProject } = renderPicker();
      const { user, field } = await open();
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

      await user.hover(screen.getByRole("option", { name: /Billing sync/ }));
      await user.click(await screen.findByRole("button", { name: "Copy the ID of Billing sync" }));

      expect((await screen.findAllByText(/Couldn't copy the ID/)).length).toBeGreaterThan(0);
      expect(onOpenProject).not.toHaveBeenCalled();
      expect(field).toBeVisible();
    });
  });

  describe("when the reader arrows to a project", () => {
    /** @scenario "The arrow-key highlighted project shows its ID and copies it" */
    it("shows the highlighted project's ID and copies it with Ctrl+C", async () => {
      const { onOpenProject } = renderPicker();
      const { user } = await open();

      // Opening highlights the current project (Web); one step down is Billing sync.
      await user.keyboard("{ArrowDown}");

      expect(await screen.findByTitle(BILLING_ID)).toBeInTheDocument();
      expect(screen.queryByTitle(WEB_ID)).not.toBeInTheDocument();

      await user.keyboard("{Control>}c{/Control}");

      await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(BILLING_ID));
      expect(onOpenProject).not.toHaveBeenCalled();
    });

    /** @scenario "The arrow-key highlighted project shows its ID and copies it" */
    it("leaves Ctrl+C alone while the search field holds text", async () => {
      renderPicker();
      const { user, field } = await open();
      await navigator.clipboard.writeText("untouched");

      searchFor("billing");
      await waitFor(() => expect(field).toHaveValue("billing"));
      await user.keyboard("{ArrowDown}{Control>}c{/Control}");

      expect(await navigator.clipboard.readText()).toBe("untouched");
    });
  });
});
