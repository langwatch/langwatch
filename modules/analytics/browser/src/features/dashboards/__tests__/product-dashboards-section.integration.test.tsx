/**
 * @vitest-environment jsdom
 * A product sidebar's Dashboards section with the organization's area on, over the real tRPC
 * hooks and a transport the test answers.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { screen, within } from "@testing-library/react";
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
  starPosition = null,
}: {
  id: string;
  homeProduct?: string;
  scope?: string;
  project?: typeof SHOP;
  starPosition?: number | null;
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
  starPosition,
});

function render({ element, listed }: { element: ReactElement; listed: unknown[] }) {
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    if (call.path === "boards.listInOrganization") return Promise.resolve(listed);
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    if (call.path === "boards.storeProjects") return Promise.resolve([SHOP]);
    return NO_PROCEDURES(call);
  };
  renderDashboards({ element, host: new StubAnalyticsHost(), answer });
  return { user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

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

  describe("given LLM Ops boards at every scope, some starred, with a project in view", () => {
    /** @scenario "The LLM Ops section in a project lists the same boards, filtered" */
    it("lists each in the section by name, a star changing nothing, and no other project's", async () => {
      render({
        element: <ProductDashboardsSection product="llm-ops" />,
        listed: [
          board({ id: "Organization board", homeProduct: "llm-ops", starPosition: 0 }),
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

  describe("given LLM Ops in a project", () => {
    /** @scenario "The LLM Ops section ends with Browse templates" */
    it("ends with Browse templates, which opens the project's templates", async () => {
      render({ element: <ProductDashboardsSection product="llm-ops" />, listed: [] });

      expect(await screen.findByRole("link", { name: "Browse templates" })).toHaveAttribute(
        "href",
        "/test-project/dashboards/templates",
      );
    });

    /** @scenario "The LLM Ops section ends with Browse templates" */
    it("is the only section with Browse templates: Gateway has none", async () => {
      render({ element: <ProductDashboardsSection product="gateway" />, listed: [] });

      await screen.findByRole("region", { name: "Dashboards" });
      expect(screen.queryByRole("link", { name: "Browse templates" })).toBeNull();
    });
  });

  describe("given no board homed in the product and no From LangWatch board", () => {
    /** @scenario "Each product's sidebar lists its own boards" */
    it("still draws the heading, New dashboard and the quiet line, and no other product's", async () => {
      render({
        element: <ProductDashboardsSection product="gateway" />,
        listed: [board({ id: "Elsewhere", homeProduct: "llm-ops", starPosition: 0 })],
      });

      const section = await screen.findByRole("region", { name: "Dashboards" });
      expect(within(section).getByText("No dashboards yet")).toBeInTheDocument();
      expect(within(section).getByText("Dashboards")).toBeInTheDocument();
      expect(await within(section).findByRole("button", { name: "New dashboard" })).toBeVisible();
      expect(within(section).queryByRole("link", { name: "Elsewhere" })).toBeNull();
    });
  });
});
