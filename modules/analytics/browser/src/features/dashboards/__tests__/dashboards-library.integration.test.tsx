/**
 * @vitest-environment jsdom
 * The organization's Dashboards library at `/dashboards`, over the real tRPC hooks and a
 * transport the test answers.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost, type StubAnalyticsHostOptions } from "../../../testing.tsx";
import DashboardsLibraryScreen from "../ui/sections/dashboards-library.screen.tsx";
import { NewDashboardDialog } from "../ui/sections/new-dashboard-dialog.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const SHOP = { id: "proj-shop", slug: "shop-abc123", name: "Shop" };
const IN_VIEW = { id: "proj-1", slug: "test-project", name: "Test Project" };
/** A store project that sorts before the project in view by name. */
const ALPHA = { id: "proj-alpha", slug: "alpha", name: "Alpha" };

const row = ({
  id,
  name,
  scope = "PROJECT",
  homeProduct = "llm-ops",
  project = SHOP,
  createdById = "someone",
  ownerName = null,
  starPosition = null,
}: {
  id: string;
  name: string;
  scope?: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  homeProduct?: DashboardHomeProduct;
  project?: typeof SHOP | null;
  createdById?: string;
  ownerName?: string | null;
  starPosition?: number | null;
}) => ({
  id,
  name,
  description: null,
  createdById,
  ownerName,
  scope,
  homeProduct,
  updatedAt: new Date("2026-11-01"),
  project,
  openProject: project ?? IN_VIEW,
  starPosition,
});

const LISTED = [
  row({ id: "board-shop", name: "Shop board", createdById: "user-1" }),
  row({
    id: "board-org",
    name: "Everyone's board",
    scope: "ORGANIZATION",
    project: null,
    ownerName: "Sam Rivera",
  }),
];

/**
 * Answers the library, the store projects and every write.
 */
function libraryServer({
  listed = LISTED,
  storeProjects = [IN_VIEW],
}: {
  listed?: unknown;
  storeProjects?: readonly (typeof IN_VIEW)[];
} = {}) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "boards.listInOrganization") {
      return listed instanceof Error ? Promise.reject(listed) : Promise.resolve(listed);
    }
    if (call.path === "boards.getAll") return Promise.resolve([]);
    if (call.path === "boards.storeProjects") return Promise.resolve(storeProjects);
    if (call.path === "boards.move") {
      const { dashboardId, homeProduct } = call.input as {
        dashboardId: string;
        homeProduct: DashboardHomeProduct;
      };
      return Promise.resolve(row({ id: dashboardId, name: "Moved", homeProduct }));
    }
    if (call.path === "boards.create" || call.path === "boards.createAtScope") {
      const { name } = call.input as { name: string };
      return Promise.resolve({ ...row({ id: "board-new", name }), projectId: IN_VIEW.id });
    }
    if (call.path === "dashboardWidgets.list") return Promise.resolve([]);
    if (call.path === "dashboardWidgets.batchUpdateLayouts") return Promise.resolve([]);
    if (call.path === "boards.delete") return Promise.resolve(row({ id: "x", name: "x" }));
    if (call.path === "boards.update") return Promise.resolve(row({ id: "x", name: "x" }));
    if (call.path === "boards.setScope") return Promise.resolve(row({ id: "x", name: "x" }));
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    return NO_PROCEDURES(call);
  };
  return { calls, answer };
}

function renderLibrary({
  listed,
  storeProjects,
  ...options
}: StubAnalyticsHostOptions & {
  listed?: unknown;
  storeProjects?: readonly (typeof IN_VIEW)[];
} = {}) {
  const host = new StubAnalyticsHost({
    projectPermissions: {
      [SHOP.id]: ["analytics:view", "analytics:update", "analytics:delete"],
      [IN_VIEW.id]: ["analytics:create", "analytics:update"],
      [ALPHA.id]: ["analytics:create", "analytics:update"],
    },
    ...options,
  });
  const server = libraryServer({ listed, storeProjects });
  const element = (
    <>
      <DashboardsLibraryScreen />
      <Toaster />
    </>
  );
  const view = renderDashboards({ element, host, answer: server.answer });
  return {
    host,
    calls: server.calls,
    unmount: view.unmount,
    user: userEvent.setup({ pointerEventsCheck: 0 }),
  };
}

afterEach(() => {
  toaster.remove();
});

const inputsTo = (calls: readonly UiProcedureCall[], path: string) =>
  calls.filter((call) => call.path === path).map((call) => call.input);

describe("the Dashboards library", () => {
  describe("when the member can see boards in the organization", () => {
    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    /** @scenario "From LangWatch boards are not listed for now" */
    it("lists boards with no project first, then by project, and no From LangWatch row", async () => {
      renderLibrary();
      const group = await screen.findByRole("region", { name: "LLM Ops" });
      const names = within(group)
        .getAllByRole("listitem")
        .map((item) => item.textContent ?? "");

      expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
      expect(screen.getByText("Every dashboard you can see, by product.")).toBeInTheDocument();
      expect(within(group).getByText("LLM Ops · 2")).toBeVisible();
      expect(screen.queryByText("From LangWatch")).toBeNull();
      expect(names).toEqual([
        expect.stringContaining("Everyone's board"),
        expect.stringContaining("Shop board"),
      ]);
    });

    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    it("names who sees each board, the member's own as theirs and another's by its author", async () => {
      renderLibrary();
      const shopRow = (await screen.findByText("Shop board")).closest("li");
      const orgRow = screen.getByText("Everyone's board").closest("li");

      expect(shopRow).toHaveTextContent("Shop");
      expect(shopRow).toHaveTextContent("You");
      expect(orgRow).toHaveTextContent("Organization");
      expect(orgRow).toHaveTextContent("Sam Rivera");
    });

    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    it("opens an Organization board at the organization's address, by id", async () => {
      const { host, user } = renderLibrary();

      await user.click(await screen.findByRole("link", { name: "Everyone's board" }));

      expect(host.navigations).toEqual(["/dashboards/board-org"]);
    });

    /** @scenario "The library lists the boards I may see, with who sees each and its owner" */
    it("opens a Project board at the organization's address too", async () => {
      const { host, user } = renderLibrary();

      await user.click(await screen.findByRole("link", { name: "Shop board" }));

      expect(host.navigations).toEqual(["/dashboards/board-shop"]);
    });
  });

  describe("when boards are homed in different products", () => {
    const HOMED = [
      row({ id: "board-gw", name: "Key spend", scope: "ORGANIZATION", homeProduct: "gateway" }),
      row({ id: "board-me", name: "Agent spend", scope: "PRIVATE", homeProduct: "me" }),
      row({ id: "board-ops", name: "Shop board" }),
    ];
    const groupLabels = () =>
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent?.split(" · ")[0]);

    /** @scenario "The library lists every board I may see, grouped by product" */
    it("groups them by product in rail order, and gives a product with none no group", async () => {
      renderLibrary({ listed: HOMED });
      await screen.findByRole("region", { name: "LLM Ops" });

      expect(groupLabels()).toEqual(["Coding agents", "LLM Ops", "Gateway"]);
      expect(screen.queryByRole("region", { name: "Governance" })).toBeNull();
    });

    /** @scenario "The library lists every board I may see, grouped by product" */
    it("lists each board in its own product's group", async () => {
      renderLibrary({ listed: HOMED });
      const llmOps = await screen.findByRole("region", { name: "LLM Ops" });
      const gateway = screen.getByRole("region", { name: "Gateway" });

      expect(within(llmOps).getByText("LLM Ops · 1")).toBeVisible();
      expect(within(gateway).getByText("Gateway · 1")).toBeVisible();
      expect(within(gateway).getAllByRole("listitem")).toEqual([
        within(gateway).getByText("Key spend").closest("li"),
      ]);
      expect(
        within(screen.getByRole("region", { name: "Coding agents" })).getByText("Agent spend"),
      ).toBeVisible();
    });
  });

  describe("when the member can see no board", () => {
    /** @scenario "An empty library" */
    it("says No dashboards yet and lists no From LangWatch group", async () => {
      renderLibrary({ listed: [] });

      expect(await screen.findByText("No dashboards yet")).toBeVisible();
      expect(
        screen.getByText("Make one for any product. It shows in that product's sidebar."),
      ).toBeVisible();
      expect(screen.queryByText("From LangWatch")).toBeNull();
    });
  });

  describe("when a group lists more than eight boards", () => {
    const ELEVEN = Array.from({ length: 11 }, (_, index) => {
      const name = `Board ${String(index + 1).padStart(2, "0")}`;
      return row({ id: `board-${index + 1}`, name });
    });
    const boardLinks = (group: HTMLElement) =>
      within(group)
        .queryAllByRole("link", { name: /^Board \d+$/ })
        .map((link) => link.textContent);

    /** @scenario 'A long group shows 8 boards, then "Show N more" and "Show less"' */
    it("shows eight, opens the rest with Show 3 more, and folds back with Show less", async () => {
      const { user } = renderLibrary({ listed: ELEVEN });
      const group = await screen.findByRole("region", { name: "LLM Ops" });
      const firstEight = ELEVEN.slice(0, 8).map((board) => board.name);

      expect(boardLinks(group)).toEqual(firstEight);
      expect(within(group).getByText("LLM Ops · 11")).toBeVisible();

      await user.click(within(group).getByRole("button", { name: "Show 3 more" }));

      expect(boardLinks(group)).toEqual(ELEVEN.map((board) => board.name));
      expect(within(group).queryByRole("button", { name: "Show 3 more" })).toBeNull();

      await user.click(within(group).getByRole("button", { name: "Show less" }));

      expect(boardLinks(group)).toEqual(firstEight);
      expect(within(group).getByRole("button", { name: "Show 3 more" })).toBeVisible();
    });

    /** @scenario 'A long group shows 8 boards, then "Show N more" and "Show less"' */
    it("offers no toggle with eight boards or fewer", async () => {
      renderLibrary({ listed: ELEVEN.slice(0, 8) });
      const group = await screen.findByRole("region", { name: "LLM Ops" });

      expect(boardLinks(group)).toHaveLength(8);
      expect(within(group).queryByRole("button", { name: /^Show / })).toBeNull();
    });

    /** @scenario "A long group stays open or folded after a reload" */
    it("keeps the group open when the library is opened again, and folded once folded", async () => {
      const first = renderLibrary({ listed: ELEVEN });
      const group = await screen.findByRole("region", { name: "LLM Ops" });
      await first.user.click(within(group).getByRole("button", { name: "Show 3 more" }));
      first.unmount();

      const second = renderLibrary({ listed: ELEVEN });
      const reopened = await screen.findByRole("region", { name: "LLM Ops" });

      expect(boardLinks(reopened)).toEqual(ELEVEN.map((board) => board.name));
      await second.user.click(within(reopened).getByRole("button", { name: "Show less" }));
      second.unmount();

      renderLibrary({ listed: ELEVEN });
      const folded = await screen.findByRole("region", { name: "LLM Ops" });

      expect(boardLinks(folded)).toHaveLength(8);
      expect(within(folded).getByRole("button", { name: "Show 3 more" })).toBeVisible();
    });
  });

  describe("when no project of the organization has Dashboards on", () => {
    it("answers the app's not-found page", async () => {
      renderLibrary({ listed: new UiProcedureRefusal("dashboards_not_enabled", 403) });

      expect(await screen.findByRole("heading", { name: "This page is not here" })).toBeVisible();
    });
  });

  describe("when the member makes a new dashboard", () => {
    /** @scenario "A board made in the library is made at its scope in one write" */
    it("stores it in the project in view at the scope Project and opens it", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      await user.click(await screen.findByRole("button", { name: "Create" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.create")).toEqual([
        { projectId: IN_VIEW.id, name: "Untitled dashboard 1", homeProduct: "llm-ops" },
      ]);
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([]);
      expect(inputsTo(calls, "boards.setScope")).toEqual([]);
      expect(host.successes.map((notice) => notice.title)).toEqual(["Dashboard created"]);
    });

    /** @scenario "A board made in the library is made at its scope in one write" */
    it("makes a board Only me in one call and opens it at the organization's address", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      await user.click(await screen.findByRole("radio", { name: /Only me/ }));
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([
        {
          projectId: IN_VIEW.id,
          name: "Untitled dashboard 1",
          scope: "PRIVATE",
          homeProduct: "llm-ops",
        },
      ]);
      expect(inputsTo(calls, "boards.create")).toEqual([]);
      expect(inputsTo(calls, "boards.setScope")).toEqual([]);
    });

    /** @scenario "Create from the library with a name, product and who can see it" */
    it("stores it in my last-used project, though another comes first by name", async () => {
      const { host, calls, user } = renderLibrary({ storeProjects: [ALPHA, IN_VIEW] });

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      await user.click(await screen.findByRole("button", { name: "Create" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.create")).toEqual([
        { projectId: IN_VIEW.id, name: "Untitled dashboard 1", homeProduct: "llm-ops" },
      ]);
    });

    /** @scenario "Create from the library with a name, product and who can see it" */
    it("stores it in the first by name when my last-used project is not among them", async () => {
      const { host, calls, user } = renderLibrary({
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

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.create")).toEqual([
        { projectId: ALPHA.id, name: "Untitled dashboard 1", homeProduct: "llm-ops" },
      ]);
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
      const product = dialog.getByRole("combobox");

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
    it("makes it homed in the product picked, at that product's scope", async () => {
      const { host, calls, dialog, user } = await openDialog();

      await user.selectOptions(dialog.getByRole("combobox"), "gateway");
      await user.click(dialog.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([
        {
          projectId: IN_VIEW.id,
          name: "Untitled dashboard 1",
          scope: "ORGANIZATION",
          homeProduct: "gateway",
        },
      ]);
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
  });

  describe("when the member moves a board to another product", () => {
    /** @scenario "Move an Organization board to Gateway" */
    it("moves it to the product picked, says so, and offers Open", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Move to product…" }));
      const dialog = within(await screen.findByRole("dialog"));
      const hint = 'Pick the product whose sidebar lists "Shop board". Old links keep opening it.';
      expect(dialog.getByText(hint)).toBeVisible();
      expect(dialog.getByRole("button", { name: "Move" })).toBeDisabled();

      await user.click(dialog.getByRole("radio", { name: /Gateway/ }));
      expect(
        dialog.getByText("Gateway has no projects, so only you will see it until you share it."),
      ).toBeVisible();
      await user.click(dialog.getByRole("button", { name: "Move" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.move")).toEqual([
          { projectId: SHOP.id, dashboardId: "board-shop", homeProduct: "gateway" },
        ]),
      );
      expect(await screen.findByText('Moved "Shop board" to Gateway')).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(host.navigations).toEqual(["/dashboards/board-shop"]);
    });

    /** @scenario "Only the author can move a Project board out of LLM Ops" */
    it("keeps another member's Project board in LLM Ops, saying only its author can move it", async () => {
      const { user } = renderLibrary({
        listed: [row({ id: "board-team", name: "Team board", createdById: "someone" })],
      });

      await user.click(await screen.findByRole("button", { name: "Actions for Team board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Move to product…" }));
      const dialog = within(await screen.findByRole("dialog"));

      expect(dialog.getByRole("radio", { name: /LLM Ops/ })).toBeEnabled();
      for (const product of [/Coding agents/, /Gateway/, /Governance/]) {
        expect(dialog.getByRole("radio", { name: product })).toBeDisabled();
      }
      expect(
        dialog.getByText("Only its author can move a Project board out of LLM Ops."),
      ).toBeVisible();
      expect(dialog.queryByText(/shared with the organization/)).toBeNull();
      expect(dialog.getByRole("button", { name: "Move" })).toBeDisabled();
    });

    /** @scenario "Move edge cases" */
    it("changes nothing on Cancel", async () => {
      const { calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Move to product…" }));
      const dialog = within(await screen.findByRole("dialog"));
      await user.click(dialog.getByRole("radio", { name: /Governance/ }));
      await user.click(dialog.getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(inputsTo(calls, "boards.move")).toEqual([]);
    });

    /** @scenario "Move needs edit rights in the owning project" */
    it("greys out Move on a board they cannot edit, saying why", async () => {
      const { user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Everyone's board" }));
      const move = await screen.findByRole("menuitem", { name: "Move to product…" });

      expect(move).toHaveAttribute("aria-disabled", "true");
      expect(move).toHaveAttribute("title", "You can view this dashboard but not change it.");
    });
  });

  describe("when the member deletes a board of a project they may delete in", () => {
    /** @scenario "Delete, rename and duplicate from the library" */
    it("asks first, deletes it from its own project, and says so", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() =>
        expect(inputsTo(calls, "boards.delete")).toEqual([
          { projectId: SHOP.id, dashboardId: "board-shop" },
        ]),
      );
      await waitFor(() =>
        expect(host.successes.map((notice) => notice.title)).toEqual(['"Shop board" deleted']),
      );
    });

    /** @scenario "Delete, rename and duplicate from the library" */
    it("offers no delete on an Organization board of a project they cannot read", async () => {
      const { user } = renderLibrary();

      const actions = await screen.findByRole("button", { name: "Actions for Everyone's board" });
      await user.click(actions);

      expect(await screen.findByRole("menuitem", { name: "Duplicate to edit" })).toBeVisible();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });
  });

  describe("when the member has starred a board", () => {
    /** @scenario "Delete, rename and duplicate from the library" */
    it("offers no Star, Unstar or star toggle on any row, a starred one included", async () => {
      const { user } = renderLibrary({
        listed: [row({ id: "board-shop", name: "Shop board", starPosition: 0 })],
      });

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));

      expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeVisible();
      expect(screen.queryByRole("menuitem", { name: "Unstar" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Unstar Shop board" })).toBeNull();
    });
  });

  describe("when the member renames a board they may edit", () => {
    /** @scenario "Delete, rename and duplicate from the library" */
    it("saves the name in place in its own project on Enter, and says so", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
      const field = await screen.findByRole("textbox", { name: "Dashboard name" });
      await user.clear(field);
      await user.type(field, "Checkout{Enter}");

      await waitFor(() =>
        expect(inputsTo(calls, "boards.update")).toEqual([
          { projectId: SHOP.id, dashboardId: "board-shop", name: "Checkout" },
        ]),
      );
      await waitFor(() =>
        expect(host.successes.map((notice) => notice.title)).toEqual(["Dashboard renamed"]),
      );
    });

    /** @scenario "Delete, rename and duplicate from the library" */
    it("saves nothing on Escape", async () => {
      const { calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
      await user.type(await screen.findByRole("textbox", { name: "Dashboard name" }), "x{Escape}");

      expect(await screen.findByRole("link", { name: "Shop board" })).toBeVisible();
      expect(inputsTo(calls, "boards.update")).toEqual([]);
    });

    /** @scenario "Delete, rename and duplicate from the library" */
    it("offers no Rename on a board of a project they cannot edit in", async () => {
      const { user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Everyone's board" }));

      expect(await screen.findByRole("menuitem", { name: "Move to product…" })).toBeVisible();
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });

  describe("when the member duplicates a board", () => {
    /** @scenario "Delete, rename and duplicate from the library" */
    it("copies it into the store project at its scope, opens it, and names the copy", async () => {
      const { host, calls, user } = renderLibrary();

      await user.click(await screen.findByRole("button", { name: "Actions for Shop board" }));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

      await waitFor(() =>
        expect(host.successes.map((notice) => notice.title)).toEqual([
          'Duplicated as "Shop board copy"',
        ]),
      );
      expect(inputsTo(calls, "boards.create")).toEqual([
        { projectId: IN_VIEW.id, name: "Shop board copy" },
      ]);
      expect(inputsTo(calls, "dashboardWidgets.list")).toEqual([
        { projectId: SHOP.id, dashboardId: "board-shop" },
      ]);
      expect(inputsTo(calls, "boards.setScope")).toEqual([]);
      expect(host.navigations).toEqual(["/dashboards/board-new"]);
    });

    /** @scenario "Delete, rename and duplicate from the library" */
    it("keeps an Only me board Only me, opened by id", async () => {
      const { host, calls, user } = renderLibrary({
        listed: [row({ id: "board-mine", name: "My notes", scope: "PRIVATE" })],
      });

      await user.click(await screen.findByRole("button", { name: "Actions for My notes" }));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([
        { projectId: IN_VIEW.id, name: "My notes copy", scope: "PRIVATE" },
      ]);
      expect(inputsTo(calls, "boards.setScope")).toEqual([]);
    });

    /** @scenario "Duplicate and Delete from the library" */
    it("keeps the product of a board homed outside LLM Ops, at its scope", async () => {
      const { host, calls, user } = renderLibrary({
        listed: [
          row({ id: "board-gw", name: "Key spend", scope: "ORGANIZATION", homeProduct: "gateway" }),
        ],
      });

      await user.click(await screen.findByRole("button", { name: "Actions for Key spend" }));
      await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

      await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-new"]));
      expect(inputsTo(calls, "boards.createAtScope")).toEqual([
        {
          projectId: IN_VIEW.id,
          name: "Key spend copy",
          scope: "ORGANIZATION",
          homeProduct: "gateway",
        },
      ]);
      expect(inputsTo(calls, "boards.create")).toEqual([]);
    });
  });
});
