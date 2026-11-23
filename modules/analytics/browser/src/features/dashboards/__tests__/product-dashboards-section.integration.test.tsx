/**
 * @vitest-environment jsdom
 * A product sidebar's Dashboards section and its Starred dashboards group with the organization's
 * area on, over the real tRPC hooks and a transport the test answers.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { OrganizationStarredSection } from "../ui/sections/organization-starred-section.tsx";
import { ProductDashboardsSection } from "../ui/sections/product-dashboards-section.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const SHOP = { id: "proj-shop", slug: "shop-abc123", name: "Shop" };

const board = ({
  id,
  homeProduct = "gateway",
  starPosition = null,
}: {
  id: string;
  homeProduct?: string;
  starPosition?: number | null;
}) => ({
  id,
  name: id,
  description: null,
  createdById: "someone",
  ownerName: null,
  scope: "ORGANIZATION",
  homeProduct,
  updatedAt: new Date("2026-11-01"),
  project: SHOP,
  openProject: SHOP,
  starPosition,
});

function render({ element, listed }: { element: ReactElement; listed: unknown[] }) {
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    if (call.path === "boards.listInOrganization") return Promise.resolve(listed);
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    if (call.path === "boards.storeProjects") return Promise.resolve([]);
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

  describe("given LLM Ops in a project", () => {
    /** @scenario "The LLM Ops section ends with Browse templates" */
    it("ends with Browse templates, which opens the project's templates", async () => {
      render({ element: <ProductDashboardsSection product="llm-ops" />, listed: [] });

      expect(await screen.findByRole("link", { name: "Browse templates" })).toHaveAttribute(
        "href",
        "/test-project/dashboards/templates",
      );
    });
  });

  describe("given no board homed in the product and no From LangWatch board", () => {
    /** @scenario "Each product's sidebar lists its own boards" */
    it("draws no section once the list has loaded", async () => {
      render({
        // The starred group reads the same list, so its row says the list has answered.
        element: (
          <>
            <ProductDashboardsSection product="governance" />
            <OrganizationStarredSection product="governance" />
          </>
        ),
        listed: [board({ id: "Elsewhere", starPosition: 0 })],
      });

      expect(await screen.findByRole("link", { name: "Elsewhere" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Dashboards" })).toBeNull();
      expect(screen.queryByText("Dashboards")).toBeNull();
    });
  });
});

describe("a product sidebar's Starred dashboards group", () => {
  /** @scenario "Every sidebar lists my stars from other products" */
  it("leaves out the stars homed in the sidebar's own product", async () => {
    render({
      element: <OrganizationStarredSection product="gateway" />,
      listed: [
        board({ id: "Gateway star", starPosition: 0 }),
        board({ id: "LLM Ops star", homeProduct: "llm-ops", starPosition: 1 }),
      ],
    });

    const list = await screen.findByRole("list", { name: "Starred dashboards" });
    expect(linkNames(list)).toEqual(["LLM Ops star"]);
  });
});
