/**
 * @vitest-environment jsdom
 * A product sidebar's Dashboards section with the organization's area on, over the real tRPC
 * hooks and a transport the test answers.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { ProductDashboardsSection } from "../ui/sections/product-dashboards-section.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const SHOP = { id: "proj-shop", slug: "shop-abc123", name: "Shop" };
/** The project the stub host has in view. */
const IN_VIEW = { id: "proj-1", slug: "test-project", name: "Test Project" };

const board = ({
  id,
  homeProduct = "gateway",
  scope = "ORGANIZATION",
  project = SHOP,
}: {
  id: string;
  homeProduct?: string;
  scope?: string;
  project?: typeof SHOP;
}) => ({
  id,
  name: id,
  description: null,
  createdById: "someone",
  ownerName: null,
  scope,
  homeProduct,
  updatedAt: new Date("2026-11-01"),
  project,
  openProject: project,
});

function render({
  element,
  listed,
  host = new StubAnalyticsHost(),
  storeProjects = [SHOP],
  sidebarOrder = [],
}: {
  element: ReactElement;
  listed: unknown[];
  host?: StubAnalyticsHost;
  storeProjects?: readonly (typeof SHOP)[];
  sidebarOrder?: readonly string[] | Error;
}) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "boards.listInOrganization") return Promise.resolve(listed);
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    if (call.path === "boards.storeProjects") return Promise.resolve(storeProjects);
    if (call.path === "boards.update") return Promise.resolve({});
    if (call.path === "boards.getAll") return Promise.resolve([]);
    if (call.path === "boards.sidebarOrder") {
      return sidebarOrder instanceof Error
        ? Promise.reject(sidebarOrder)
        : Promise.resolve({ dashboardIds: sidebarOrder });
    }
    if (call.path === "boards.reorderSidebar") return Promise.resolve({ success: true });
    return NO_PROCEDURES(call);
  };
  renderDashboards({ element, host, answer });
  return { host, calls, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const inputsTo = (calls: UiProcedureCall[], path: string) =>
  calls.filter((call) => call.path === path).map((call) => call.input);

const linkNames = (list: HTMLElement) =>
  within(list)
    .queryAllByRole("link")
    .map((link) => link.textContent);

describe("a product's Dashboards section", () => {
  describe("given more of the product's boards than the section shows", () => {
    /** @scenario "Each product's sidebar lists its own boards" */
    it("lists 8 by name, then Show N more and Show less, and none from other products", async () => {
      const gateway = Array.from({ length: 10 }, (_, index) => board({ id: `Board ${index}` }));
      const { user } = render({
        element: <ProductDashboardsSection product="gateway" />,
        listed: [...gateway, board({ id: "Elsewhere", homeProduct: "llm-ops" })],
      });

      const list = await screen.findByRole("list", { name: "Dashboards" });
      expect(linkNames(list)).toHaveLength(8);
      expect(within(list).queryByRole("link", { name: "Elsewhere" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Show 2 more" }));
      expect(linkNames(list)).toHaveLength(10);
      expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
    });
  });

  describe("given the member's sidebar order cannot be read", () => {
    /** @scenario "Reordering in one project keeps the place of boards listed only in another" */
    it("lists the boards by name and offers no reorder, so a save cannot drop stored slots", async () => {
      render({
        element: <ProductDashboardsSection product="gateway" />,
        listed: [board({ id: "Beta" }), board({ id: "Alpha" })],
        sidebarOrder: new UiProcedureRefusal("forbidden", 403),
      });

      const list = await screen.findByRole("list", { name: "Dashboards" });
      expect(linkNames(list)).toEqual(["Alpha", "Beta"]);
      expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
    });
  });

  describe("given LLM Ops boards at every scope, with a project in view", () => {
    /** @scenario "The LLM Ops section in a project lists the same boards, filtered" */
    it("lists each in the section by name, stars read nowhere, and no other project's", async () => {
      render({
        element: <ProductDashboardsSection product="llm-ops" />,
        listed: [
          board({ id: "Organization board", homeProduct: "llm-ops" }),
          board({ id: "Only me board", homeProduct: "llm-ops", scope: "PRIVATE" }),
          board({
            id: "Project board",
            homeProduct: "llm-ops",
            scope: "PROJECT",
            project: IN_VIEW,
          }),
          board({ id: "Shop's Project board", homeProduct: "llm-ops", scope: "PROJECT" }),
        ],
      });

      const list = await screen.findByRole("list", { name: "Dashboards" });
      expect(linkNames(list)).toEqual(["Only me board", "Organization board", "Project board"]);
      expect(screen.queryByRole("list", { name: "Starred" })).toBeNull();
    });
  });

  describe("given my own My dashboard in the project in view and another in Shop", () => {
    const myDashboard = ({ id, project }: { id: string; project: typeof SHOP }) => ({
      ...board({ id, homeProduct: "llm-ops", scope: "PRIVATE", project }),
      name: "My dashboard",
      createdById: "user-1",
    });

    /** @scenario "The sidebar lists only my My dashboard for the project I am in" */
    it("lists mine of the project in view alone, and another member's My dashboard as before", async () => {
      render({
        element: <ProductDashboardsSection product="llm-ops" />,
        listed: [
          myDashboard({ id: "mine-in-shop", project: SHOP }),
          myDashboard({ id: "mine-here", project: IN_VIEW }),
          { ...board({ id: "theirs", homeProduct: "llm-ops" }), name: "My dashboard" },
        ],
      });

      const list = await screen.findByRole("list", { name: "Dashboards" });
      const hrefs = within(list)
        .getAllByRole("link", { name: "My dashboard" })
        .map((link) => link.getAttribute("href"));
      expect(hrefs).toEqual(["/dashboards/mine-here", "/dashboards/theirs"]);
    });
  });

  describe("given the board I have open is listed", () => {
    // The params each board route captures, as the route table declares them.
    describe.each([
      { address: "/dashboards/Checkout", params: { dashboardId: "Checkout" } },
      {
        address: "/shop-abc123/dashboards/Checkout",
        params: { project: SHOP.slug, dashboardId: "Checkout" },
      },
    ])("when it is open at $address", ({ params }) => {
      /** @scenario "The open board's sidebar row is marked as the page I am on" */
      it("marks its row, and no other, as the current page", async () => {
        render({
          element: <ProductDashboardsSection product="gateway" />,
          listed: [board({ id: "Checkout" }), board({ id: "Refunds" })],
          host: new StubAnalyticsHost({ route: { params, query: {} } }),
        });

        const list = await screen.findByRole("list", { name: "Dashboards" });
        expect(within(list).getByRole("link", { name: "Checkout" })).toHaveAttribute(
          "aria-current",
          "page",
        );
        expect(within(list).getByRole("link", { name: "Refunds" })).not.toHaveAttribute(
          "aria-current",
        );
      });
    });
  });

  describe("given LLM Ops with no saved board", () => {
    /** @scenario "From LangWatch boards are not listed for now" */
    it("says No dashboards yet and lists no From LangWatch group", async () => {
      render({ element: <ProductDashboardsSection product="llm-ops" />, listed: [] });

      const section = await screen.findByRole("region", { name: "Dashboards" });
      expect(within(section).getByText("No dashboards yet")).toBeInTheDocument();
      expect(within(section).queryByText("From LangWatch")).toBeNull();
      expect(screen.queryByRole("list", { name: "From LangWatch" })).toBeNull();
    });
  });

  describe("given any product in a project", () => {
    /** @scenario "The Dashboards section has no templates entry" */
    it.each(["llm-ops", "gateway"] as const)("has no Browse templates in %s", async (product) => {
      render({ element: <ProductDashboardsSection product={product} />, listed: [] });

      await screen.findByRole("region", { name: "Dashboards" });
      expect(screen.queryByText("Browse templates")).toBeNull();
    });
  });

  describe("given no board homed in the product", () => {
    /** @scenario "Each product's sidebar lists its own boards" */
    it("still draws the heading, New dashboard and the quiet line, and no other product's", async () => {
      render({
        element: <ProductDashboardsSection product="gateway" />,
        listed: [board({ id: "Elsewhere", homeProduct: "llm-ops" })],
        host: new StubAnalyticsHost({ projectPermissions: { [SHOP.id]: ["analytics:update"] } }),
      });

      const section = await screen.findByRole("region", { name: "Dashboards" });
      expect(within(section).getByText("No dashboards yet")).toBeInTheDocument();
      expect(within(section).getByText("Dashboards")).toBeInTheDocument();
      expect(await within(section).findByRole("button", { name: "New dashboard" })).toBeVisible();
      expect(within(section).queryByRole("link", { name: "Elsewhere" })).toBeNull();
    });
  });

  describe("given a store project where the member may create but not update", () => {
    /** @scenario "Each product's sidebar lists its own boards" */
    it("offers New dashboard in LLM Ops, where a board can be Project, and none in Gateway", async () => {
      render({
        element: (
          <>
            <ProductDashboardsSection product="llm-ops" />
            <ProductDashboardsSection product="gateway" />
          </>
        ),
        listed: [],
      });

      // Both sections read the same store project, so once LLM Ops offers it, Gateway has decided.
      await screen.findByRole("button", { name: "New dashboard" });
      const [llmOps, gateway] = screen.getAllByRole("region", { name: "Dashboards" });
      if (!llmOps || !gateway) throw new Error("expected two Dashboards sections");
      expect(within(llmOps).getByRole("button", { name: "New dashboard" })).toBeVisible();
      expect(within(gateway).queryByRole("button", { name: "New dashboard" })).toBeNull();
    });
  });

  describe("given no project where the member may create", () => {
    /**
     * @scenario "Create from the library with a name, product and who can see it"
     * @scenario "Nobody without analytics:create anywhere is offered creation"
     */
    it("offers no New dashboard in any product's section", async () => {
      const { calls } = render({
        element: (
          <>
            <ProductDashboardsSection product="me" />
            <ProductDashboardsSection product="llm-ops" />
            <ProductDashboardsSection product="gateway" />
            <ProductDashboardsSection product="governance" />
          </>
        ),
        listed: [],
        host: new StubAnalyticsHost({
          projectPermissions: { [SHOP.id]: ["analytics:view", "analytics:update"] },
        }),
        storeProjects: [],
      });

      await waitFor(() => expect(screen.getAllByText("No dashboards yet")).toHaveLength(4));
      // Absence only counts once the store projects are answered.
      await waitFor(() => expect(calls.map((call) => call.path)).toContain("boards.storeProjects"));
      expect(screen.queryByRole("button", { name: "New dashboard" })).toBeNull();
    });
  });

  describe("given a board of a project where the member may edit and delete", () => {
    const editor = () =>
      new StubAnalyticsHost({
        projectPermissions: { [SHOP.id]: ["analytics:update", "analytics:delete"] },
      });

    describe("when they open its row's menu", () => {
      /** @scenario "A sidebar row shows the library's menu on hover" */
      it("offers the library's Rename, Move to product…, Duplicate and Delete, and opens nothing", async () => {
        const { host, user } = render({
          element: <ProductDashboardsSection product="gateway" />,
          listed: [board({ id: "Checkout" })],
          host: editor(),
        });

        await user.click(await screen.findByRole("button", { name: "Actions for Checkout" }));

        const items = await screen.findAllByRole("menuitem");
        expect(items.map((item) => item.textContent)).toEqual([
          "Rename",
          "Move to product…",
          "Duplicate",
          "Delete",
        ]);
        expect(host.navigations).toEqual([]);
      });
    });

    describe("when they rename it from the menu", () => {
      /** @scenario "A sidebar row shows the library's menu on hover" */
      it("edits the name in place and saves it in the owning project on Enter", async () => {
        const { calls, user } = render({
          element: <ProductDashboardsSection product="gateway" />,
          listed: [board({ id: "Checkout" })],
          host: editor(),
        });

        await user.click(await screen.findByRole("button", { name: "Actions for Checkout" }));
        await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
        const field = await screen.findByRole("textbox", { name: "Dashboard name" });
        await user.clear(field);
        await user.type(field, "Refunds{Enter}");

        await waitFor(() =>
          expect(inputsTo(calls, "boards.update")).toEqual([
            { projectId: SHOP.id, dashboardId: "Checkout", name: "Refunds" },
          ]),
        );
      });
    });
  });

  describe("given a board of a project where the member may only view", () => {
    /** @scenario "A sidebar row shows the library's menu on hover" */
    it("offers no Rename and no Delete, and Move greyed out as the library does", async () => {
      const { user } = render({
        element: <ProductDashboardsSection product="gateway" />,
        listed: [board({ id: "Checkout" })],
      });

      await user.click(await screen.findByRole("button", { name: "Actions for Checkout" }));

      const move = await screen.findByRole("menuitem", { name: "Move to product…" });
      expect(move).toHaveAttribute("aria-disabled", "true");
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });
  });

  describe("given a new board open and not stored yet", () => {
    /** @scenario "AC162h The product sidebar lists the new board while it is open" */
    it("lists it first by its untitled name as the page in view, with no empty note", async () => {
      render({
        element: <ProductDashboardsSection product="llm-ops" />,
        listed: [],
        host: new StubAnalyticsHost({ route: { params: { dashboardId: "new" }, query: {} } }),
      });

      const list = await screen.findByRole("list", { name: "New dashboard" });
      const row = await within(list).findByRole("link", { name: /Untitled dashboard/ });
      expect(row).toHaveAttribute("aria-current", "page");
      expect(screen.queryByText("No dashboards yet")).toBeNull();
    });

    describe("when the member opens its row's menu", () => {
      const openDraft = () =>
        render({
          element: <ProductDashboardsSection product="llm-ops" />,
          listed: [],
          host: new StubAnalyticsHost({ route: { params: { dashboardId: "new" }, query: {} } }),
        });

      /** @scenario "AC162k The new board's sidebar row has its menu before it is stored" */
      it("offers Rename and Delete", async () => {
        const { user } = openDraft();

        await user.click(
          await screen.findByRole("button", { name: /^Actions for Untitled dashboard/ }),
        );

        const items = await screen.findAllByRole("menuitem");
        expect(items.map((item) => item.textContent)).toEqual(["Rename", "Delete"]);
      });

      /** @scenario "AC162k The new board's sidebar row has its menu before it is stored" */
      it("throws the board away on Delete, storing nothing, and leaves for the dashboards", async () => {
        const { host, calls, user } = openDraft();

        await user.click(
          await screen.findByRole("button", { name: /^Actions for Untitled dashboard/ }),
        );
        await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

        expect(host.navigations).toEqual(["/test-project/dashboards"]);
        expect(calls.filter(({ path }) => path.startsWith("boards.create"))).toEqual([]);
      });
    });
  });

  describe("given LLM Ops in the project in view, which is the store project", () => {
    /** @scenario "AC162i A product sidebar's '+' in a project opens the new board in that project" */
    it("opens the board unsaved at the project's address and lists it by the name typed", async () => {
      const host = new StubAnalyticsHost({
        projectPermissions: { [IN_VIEW.id]: ["analytics:create", "analytics:update"] },
      });
      const { calls, user } = render({
        element: <ProductDashboardsSection product="llm-ops" />,
        listed: [],
        host,
        storeProjects: [IN_VIEW],
      });

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      const name = await screen.findByRole("textbox");
      await user.clear(name);
      await user.type(name, "Support costs");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(host.navigations).toEqual([`/${IN_VIEW.slug}/dashboards/new`]);
      // The sidebar as the app draws it at the new address.
      cleanup();
      render({
        element: <ProductDashboardsSection product="llm-ops" />,
        listed: [],
        host: new StubAnalyticsHost({ route: { params: { dashboardId: "new" }, query: {} } }),
        storeProjects: [IN_VIEW],
      });
      const list = await screen.findByRole("list", { name: "New dashboard" });
      const row = within(list).getByRole("link", { name: "Support costs" });
      expect(row).toHaveAttribute("aria-current", "page");
      expect(calls.filter(({ path }) => path.startsWith("boards.create"))).toEqual([]);
    });
  });

  describe("given Gateway, whose boards open in Dashboards", () => {
    /** @scenario "AC162i A product sidebar's '+' in a project opens the new board in that project" */
    it("opens the new board at /dashboards/new", async () => {
      const host = new StubAnalyticsHost({
        projectPermissions: { [IN_VIEW.id]: ["analytics:create", "analytics:update"] },
      });
      const { user } = render({
        element: <ProductDashboardsSection product="gateway" />,
        listed: [],
        host,
        storeProjects: [IN_VIEW],
      });

      await user.click(await screen.findByRole("button", { name: "New dashboard" }));
      await user.click(await screen.findByRole("button", { name: "Create" }));

      expect(host.navigations).toEqual(["/dashboards/new"]);
    });
  });

  describe("given no new board open", () => {
    /** @scenario "AC162h The product sidebar lists the new board while it is open" */
    it("lists no new board row", async () => {
      render({ element: <ProductDashboardsSection product="llm-ops" />, listed: [] });

      expect(await screen.findByText("No dashboards yet")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "New dashboard" })).toBeNull();
    });
  });
});
