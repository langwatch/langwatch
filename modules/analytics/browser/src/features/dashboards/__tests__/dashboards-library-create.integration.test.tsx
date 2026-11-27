/**
 * @vitest-environment jsdom
 * Making a dashboard from the organization's Dashboards library: the dialog, the unsaved board it
 * opens (stored at its scope and product on the first edit), and who is offered creation at all.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { toaster } from "@langwatch/design-system/toaster";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { useDraftFrame } from "../behavior/use-draft-board.ts";
import { NewDashboardDialog } from "../ui/sections/new-dashboard-dialog.tsx";
import { ALPHA, IN_VIEW, inputsTo, renderLibrary } from "./dashboards-library.test-helpers.tsx";
import { renderDashboards } from "./render-dashboards.test-helpers.tsx";

afterEach(() => {
  toaster.remove();
});

function DraftProject() {
  return <output aria-label="Draft project">{useDraftFrame().project?.id}</output>;
}

/** The store project the unsaved board is held for, read off the draft. */
async function heldIn() {
  renderDashboards({ element: <DraftProject />, host: new StubAnalyticsHost() });
  return (await screen.findByRole("status", { name: "Draft project" })).textContent;
}

describe("the Dashboards library's creation", () => {
  describe("when the member makes a new dashboard", () => {
    /** @scenario "A board made in the library is made at its scope in one write" */
    it("opens it unsaved at the organization's address, writing nothing yet", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      await user.click(await screen.findByRole("radio", { name: /Only me/ }));
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/new"]));
      expect(inputsTo(calls, "boards.create")).toEqual([]);
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([]);
      expect(inputsTo(calls, "boards.setScope")).toEqual([]);
      expect(host.successes).toEqual([]);
    });

    /** @scenario "Create from the library with a name, product and who can see it" */
    it("holds it for my last-used project, though another comes first by name", async () => {
      const { user } = renderLibrary({ storeProjects: [ALPHA, IN_VIEW] });

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      await user.click(await screen.findByRole("button", { name: "Create" }));

      expect(await heldIn()).toBe(IN_VIEW.id);
    });

    /** @scenario "Create from the library with a name, product and who can see it" */
    it("holds it for the first by name when my last-used project is not among them", async () => {
      const { user } = renderLibrary({
        storeProjects: [ALPHA, IN_VIEW],
        project: {
          id: "proj-elsewhere",
          slug: "elsewhere",
          name: "Elsewhere",
          hasFirstMessage: true,
        },
      });

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      await user.click(await screen.findByRole("button", { name: "Create" }));

      expect(await heldIn()).toBe(ALPHA.id);
    });
  });

  describe("when the member picks the product of a new dashboard", () => {
    const openDialog = async () => {
      const rendered = renderLibrary();
      await rendered.user.click(await screen.findByRole("button", { name: "New dashboard" }));
      const dialog = within(await screen.findByRole("dialog"));
      return { ...rendered, dialog };
    };

    /** @scenario "Create from the library with a name, product and who can see it" */
    it("starts in LLM Ops at Project, and resets who can see it per product", async () => {
      const { dialog, user } = await openDialog();
      const product = dialog.getByRole("combobox", { name: "Product" });

      expect(product).toHaveValue("llm-ops");
      expect(dialog.getByRole("radio", { name: /Project/ })).toBeChecked();
      expect(dialog.getByText("Lives in LLM Ops. Move it from Dashboards.")).toBeVisible();

      await user.selectOptions(product, "me");
      expect(dialog.getByRole("radio", { name: /Only me/ })).toBeChecked();
      expect(dialog.queryByRole("radio", { name: /Project/ })).toBeNull();

      await user.selectOptions(product, "governance");
      expect(dialog.getByRole("radio", { name: /Organization/ })).toBeChecked();

      await user.selectOptions(product, "gateway");
      expect(dialog.getByRole("radio", { name: /Organization/ })).toBeChecked();
      expect(dialog.queryByRole("radio", { name: /Project/ })).toBeNull();
      expect(dialog.getByText("Lives in Gateway. Move it from Dashboards.")).toBeVisible();
      expect(dialog.getByText(`Stored in ${IN_VIEW.name}.`)).toBeVisible();
    });

    /** @scenario "Create from the library with a name, product and who can see it" */
    it("opens the new board unsaved, whichever product is picked", async () => {
      const { host, calls, dialog, user } = await openDialog();

      await user.selectOptions(dialog.getByRole("combobox", { name: "Product" }), "gateway");
      await user.click(dialog.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/new"]));
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([]);
      expect(inputsTo(calls, "boards.create")).toEqual([]);
    });

    /** @scenario "The create dialog refuses an empty name, and Cancel makes nothing" */
    it("disables Create while the name is empty or spaces, and Cancel makes nothing", async () => {
      const { calls, dialog, user } = await openDialog();
      const name = dialog.getByRole("textbox");

      await user.clear(name);
      expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
      await user.type(name, "   ");
      expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
      await user.click(dialog.getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(inputsTo(calls, "boards.create")).toEqual([]);
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([]);
    });
  });

  describe("when the member picks the project of a new Project dashboard", () => {
    const openDialog = async () => {
      const rendered = renderLibrary({ storeProjects: [ALPHA, IN_VIEW] });
      await rendered.user.click(await screen.findByRole("button", { name: "New dashboard" }));
      const dialog = within(await screen.findByRole("dialog"));
      return { ...rendered, dialog };
    };

    /** @scenario "In the library, a Project board's project is picked under Project" */
    it("shows my last-used project under Project, and keeps the board in the one picked", async () => {
      const { dialog, user } = await openDialog();
      const picker = dialog.getByTestId("new-dashboard-project");

      const trigger = within(picker).getByRole("combobox");
      expect(trigger.textContent).toContain(IN_VIEW.name);
      expect(dialog.getByText(`Everyone in ${IN_VIEW.name}`)).toBeVisible();

      await user.click(trigger);
      await user.click(await screen.findByRole("option", { name: new RegExp(ALPHA.name) }));
      expect(dialog.getByText(`Everyone in ${ALPHA.name}`)).toBeVisible();
      await user.click(dialog.getByRole("button", { name: "Create" }));

      expect(await heldIn()).toBe(ALPHA.id);
    });

    /** @scenario "In the library, a Project board's project is picked under Project" */
    it("shows no project picker for Organization or Only me", async () => {
      const { dialog, user } = await openDialog();

      await user.click(dialog.getByRole("radio", { name: /Organization/ }));
      expect(dialog.queryByTestId("new-dashboard-project")).toBeNull();
      await user.click(dialog.getByRole("radio", { name: /Only me/ }));
      expect(dialog.queryByTestId("new-dashboard-project")).toBeNull();
    });
  });

  describe('when a product\'s "+" opens the new dashboard dialog', () => {
    /** @scenario A product's "+" fixes the product and says where the board lives */
    it("asks no product, says where it lives, and makes it there", async () => {
      const made: unknown[] = [];
      renderDashboards({
        element: (
          <NewDashboardDialog
            product="gateway"
            takenNamesIn={() => ["Untitled dashboard 1"]}
            projectName={IN_VIEW.name}
            organizationName="Acme"
            mayShare
            isCreating={false}
            onCreate={(input) => {
              made.push(input);
              return Promise.resolve(true);
            }}
            onClose={() => void 0}
          />
        ),
        host: new StubAnalyticsHost(),
      });
      const dialog = within(await screen.findByRole("dialog"));

      expect(dialog.queryByRole("combobox")).toBeNull();
      expect(dialog.getByText("Lives in Gateway. Move it from Dashboards.")).toBeVisible();
      expect(dialog.getByRole("radio", { name: /Organization/ })).toBeChecked();
      expect(dialog.queryByRole("radio", { name: /Project/ })).toBeNull();

      await userEvent
        .setup({ pointerEventsCheck: 0 })
        .click(dialog.getByRole("button", { name: "Create" }));

      await waitFor(() =>
        expect(made).toEqual([
          { name: "Untitled dashboard 2", scope: "ORGANIZATION", homeProduct: "gateway" },
        ]),
      );
    });

    /** @scenario A product's "+" inside a project offers no project picker */
    it("keeps an LLM Ops board in the project in view, with no project picker", async () => {
      const made: unknown[] = [];
      renderDashboards({
        element: (
          <NewDashboardDialog
            product="llm-ops"
            takenNamesIn={() => []}
            projectName={IN_VIEW.name}
            organizationName="Acme"
            mayShare
            isCreating={false}
            onCreate={(input) => {
              made.push(input);
              return Promise.resolve(true);
            }}
            onClose={() => void 0}
          />
        ),
        host: new StubAnalyticsHost(),
      });
      const dialog = within(await screen.findByRole("dialog"));

      expect(dialog.getByRole("radio", { name: /Project/ })).toBeChecked();
      expect(dialog.getByText(`Everyone in ${IN_VIEW.name}`)).toBeVisible();
      expect(dialog.queryByTestId("new-dashboard-project")).toBeNull();
      await userEvent
        .setup({ pointerEventsCheck: 0 })
        .click(dialog.getByRole("button", { name: "Create" }));

      await waitFor(() =>
        expect(made).toEqual([
          { name: "Untitled dashboard 1", scope: "PROJECT", homeProduct: "llm-ops" },
        ]),
      );
    });
  });

  describe("given no project where the member may create", () => {
    /** Absence only counts once the store projects are answered, so wait for that read. */
    const storeProjectsRead = (calls: readonly UiProcedureCall[]) =>
      waitFor(() => expect(calls.map((call) => call.path)).toContain("boards.storeProjects"));

    /**
     * @scenario "Create from the library with a name, product and who can see it"
     * @scenario "Nobody without analytics:create anywhere is offered creation"
     */
    it("offers no New dashboard, in the header or the empty library", async () => {
      const { calls } = renderLibrary({ listed: [], storeProjects: [] });

      expect(await screen.findByText("No dashboards yet")).toBeVisible();
      await storeProjectsRead(calls);
      expect(screen.queryByRole("button", { name: "New dashboard" })).toBeNull();
    });

    /**
     * @scenario "Create from the library with a name, product and who can see it"
     * @scenario "Nobody without analytics:create anywhere is offered creation"
     */
    it("offers no Duplicate on a board they may edit, and no New dashboard", async () => {
      const { calls, user } = renderLibrary({ storeProjects: [] });

      await storeProjectsRead(calls);
      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));

      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        "Rename",
        "Move to product…",
        "Delete",
      ]);
      expect(screen.queryByRole("button", { name: "New dashboard" })).toBeNull();
    });

    /** @scenario "Create from the library with a name, product and who can see it" */
    it("offers no Duplicate to edit on a board they may not edit", async () => {
      const { calls, user } = renderLibrary({ storeProjects: [] });

      await storeProjectsRead(calls);
      await user.click(await screen.findByRole("button", { name: "Actions for Everyone's board" }));

      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual(["Move to product…"]);
    });
  });
});
