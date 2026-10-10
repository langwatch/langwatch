/**
 * @vitest-environment jsdom
 * specs/automations/list-pages.feature, specs/automations/source-merge.feature (#6716 defects,
 * ADR-093 §1); an aggregate (ADR-177) offers no create: specs/governance/aggregate-project.feature.
 */
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import type { AutomationSection } from "../automations-layout.tsx";
import { AutomationsPage } from "../automations-screen.tsx";
import type * as ListPagesFixture from "./list-pages.fixture.ts";
import { listPagesMocks } from "./list-pages.fixture.ts";

const { projectKind } = vi.hoisted(() => ({ projectKind: { current: "application" } }));

vi.mock("../../../behavior/automation-session.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: {
      id: "proj-1",
      slug: "test-project",
      name: "Test Project",
      kind: projectKind.current,
    },
    organization: { id: "org-1" },
    team: { slug: "team-1" },
  }),
}));

vi.mock("../../../behavior/automation-api.ts", async () => {
  const fixture = await vi.importActual<typeof ListPagesFixture>("./list-pages.fixture.ts");
  return { api: fixture.listPagesApi(), slackApi: fixture.listPagesSlackApi() };
});

function renderPage(section: AutomationSection) {
  const host = fakeAutomationHost({ permissions: ["triggers:manage"], query: {} });
  const view = renderWithAutomationHost(<AutomationsPage section={section} />, { host });
  return { host, view };
}

type MutateOptions = { onSuccess: () => void };
const succeed = (_input: unknown, options: MutateOptions) => options.onSuccess();

async function openDeleteDialog({ rowName, itemName }: { rowName: string; itemName: RegExp }) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(`Actions for ${rowName}`));
  await user.click(screen.getByRole("menuitem", { name: itemName }));
  return user;
}

describe("given the unified automations table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectKind.current = "application";
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the open project is an aggregate reached by its address", () => {
    /** @scenario "The app marks the aggregate and offers no way to add data to it" */
    it("says data can't be added and offers no way to create an automation", () => {
      projectKind.current = "aggregate";

      renderPage("automations");

      expect(screen.getByText("Data can't be added to this project")).toBeInTheDocument();
      expect(screen.queryByText("New automation")).toBeNull();
    });
  });

  describe("when the project has automations watching a filter and a graph", () => {
    /** @scenario "The unified table lists automations watching filters and graphs together" */
    it("lists both in one table, each saying what it watches and where it delivers", () => {
      renderPage("automations");

      const table = within(screen.getByRole("table"));
      expect(table.getByText("Cost spike")).toBeInTheDocument();
      expect(table.getByText("Flag failures")).toBeInTheDocument();
      expect(table.getByText("Graph · Cost graph")).toBeInTheDocument();
      expect(table.getAllByText("Trace filter").length).toBeGreaterThan(0);
      expect(table.getAllByText("status:error").length).toBeGreaterThan(0);
      expect(table.getByText("a@b.com")).toBeInTheDocument();
      expect(table.getByText("Slack app · channel C0999999")).toBeInTheDocument();
      expect(table.getByText("https://example.com/hooks/langwatch")).toBeInTheDocument();
    });

    /** @scenario "Reports stay on their own tab" */
    it("keeps reports out of it and lists them on their own tab", () => {
      const { view } = renderPage("automations");
      expect(screen.queryByText("Weekly digest")).not.toBeInTheDocument();
      view.unmount();

      renderPage("reports");

      expect(screen.getByText("Weekly digest")).toBeInTheDocument();
    });
  });

  describe("when the user chooses Delete on a graph-watching row", () => {
    /** @scenario "Deleting names the row an automation, whatever it watches" */
    it("names it an automation in the dialog and in the toast", async () => {
      listPagesMocks.deleteMutate.mockImplementation(succeed);
      const { host } = renderPage("automations");

      const user = await openDeleteDialog({
        rowName: "Cost spike",
        itemName: /Delete automation Cost spike/,
      });

      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.getByText("Delete automation")).toBeInTheDocument();
      expect(dialog.getByText(/This permanently deletes "Cost spike"/)).toBeInTheDocument();
      expect(listPagesMocks.deleteMutate).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(host.recording.successes).toContainEqual(
        expect.objectContaining({ title: "Delete automation", description: "Automation deleted" }),
      );
    });
  });

  describe("when the user confirms the deletion", () => {
    /** @scenario Confirming the dialog deletes the row everywhere it could reappear */
    it("deletes the row and invalidates the drawer cache", async () => {
      listPagesMocks.deleteMutate.mockImplementation(succeed);
      renderPage("automations");

      const user = await openDeleteDialog({
        rowName: "Cost spike",
        itemName: /Delete automation Cost spike/,
      });
      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(listPagesMocks.deleteMutate).toHaveBeenCalledWith(
        { triggerId: "alert-1", projectId: "proj-1" },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
      expect(listPagesMocks.invalidateTriggerById).toHaveBeenCalled();
    });
  });

  describe("when the user dismisses the dialog without confirming", () => {
    /** @scenario Cancelling the dialog leaves the row untouched */
    it("leaves the row untouched", async () => {
      renderPage("automations");

      const user = await openDeleteDialog({
        rowName: "Cost spike",
        itemName: /Delete automation Cost spike/,
      });
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(listPagesMocks.deleteMutate).not.toHaveBeenCalled();
    });
  });

  describe("when the row's actions menu is opened", () => {
    /** @scenario View, Edit, and Delete each have their own accessible name */
    it("exposes an accessible name for View, Edit, and Delete", async () => {
      renderPage("automations");

      await userEvent.setup().click(screen.getByLabelText("Actions for Cost spike"));

      expect(screen.getByRole("menuitem", { name: /View Cost spike/ })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Edit Cost spike/ })).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: /Delete automation Cost spike/ }),
      ).toBeInTheDocument();
    });
  });
});

describe("given the Reports table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the user deletes a report row", () => {
    /** @scenario Deleting a report names it as a report, not an automation */
    it("names the row a report, not an automation", async () => {
      listPagesMocks.deleteMutate.mockImplementation(succeed);
      const { host } = renderPage("reports");

      const user = await openDeleteDialog({
        rowName: "Weekly digest",
        itemName: /Delete report Weekly digest/,
      });
      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(host.recording.successes).toContainEqual(
        expect.objectContaining({ title: "Delete report", description: "Report deleted" }),
      );
    });
  });
});
