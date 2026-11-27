/**
 * @vitest-environment jsdom
 * A board opened by id at the organization level, `/dashboards/<id>`, over the real tRPC hooks
 * and a transport the test answers.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it } from "vitest";

import { type AnalyticsHostProject, AnalyticsHostProvider } from "../../../model/analytics-host.ts";
import {
  ANALYTICS_MEMBER_PERMISSIONS,
  StubAnalyticsHost,
  type StubAnalyticsHostOptions,
} from "../../../testing.tsx";
import { finderPool } from "../model/template-library.ts";
import OrganizationBoardScreen from "../ui/sections/organization-board.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const SHOP = { id: "proj-shop", slug: "shop-abc123", name: "Shop" };

/** Projects the LLM Ops top bar can put in view. */
const TEST_PROJECT = { id: "proj-1", slug: "test-project", name: "Test Project" };
const OPS = { id: "proj-ops", slug: "ops-def456", name: "Ops" };
const CHECKOUT = { id: "proj-checkout", slug: "checkout-ghi789", name: "Checkout" };

const inView = (project: typeof SHOP): AnalyticsHostProject => ({
  ...project,
  hasFirstMessage: true,
});

const resolved = ({
  id,
  scope,
  project,
  openProject = project,
  homeProduct = "llm-ops",
}: {
  id: string;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  project: typeof SHOP | null;
  openProject?: typeof SHOP | null;
  homeProduct?: DashboardHomeProduct;
}) => ({
  id,
  name: "Everyone's board",
  description: null,
  createdById: "someone",
  scope,
  homeProduct,
  updatedAt: new Date("2026-11-01"),
  project,
  openProject,
  ownerName: null,
});

/** The board as the project it opens in lists it: an Organization board that project owns. */
const LISTED_IN_SHOP = {
  id: "board-org",
  projectId: SHOP.id,
  name: "Everyone's board",
  description: null,
  createdById: "someone",
  scope: "ORGANIZATION",
  organizationId: "org-1",
  ownerProject: null,
  isStarred: false,
  updatedAt: new Date("2026-11-01"),
};

const LANGY_EDITOR_PERMISSIONS = [...ANALYTICS_MEMBER_PERMISSIONS, "langy:create"];

/**
 * A member who may edit the board and ask Langy, in the project in view and in "Shop", so an
 * empty board shows all it offers.
 */
const LANGY_EDITOR: StubAnalyticsHostOptions = {
  flags: { release_dashboards: true, release_langy_enabled: true },
  permissions: LANGY_EDITOR_PERMISSIONS,
  projectPermissions: { [SHOP.id]: LANGY_EDITOR_PERMISSIONS },
};

const hostIn = (
  project: AnalyticsHostProject | undefined,
  options: StubAnalyticsHostOptions = {},
) =>
  new StubAnalyticsHost({
    ...options,
    project,
    route: { params: { dashboardId: "board-org" }, query: {} },
  });

/** The LLM Ops top bar as a board sees it: the project in view, switched in place. */
function TopBarProjectSwitch({
  hosts,
  children,
}: {
  hosts: readonly StubAnalyticsHost[];
  children: ReactNode;
}) {
  const [shown, setShown] = useState(0);
  return (
    <>
      {hosts.map((host, index) => (
        <button key={host.project()?.id ?? "none"} type="button" onClick={() => setShown(index)}>
          Switch to {host.project()?.name}
        </button>
      ))}
      <AnalyticsHostProvider value={hosts[shown]}>{children}</AnalyticsHostProvider>
    </>
  );
}

function renderBoard({
  answer,
  homeProduct = "llm-ops",
  projectInView = inView(TEST_PROJECT),
  switchTo = [],
  asLangyEditor = false,
}: {
  answer: unknown;
  /** The home the project's list answers for the board. */
  homeProduct?: DashboardHomeProduct;
  /** The project the LLM Ops top bar has in view; null for a member who never opened one. */
  projectInView?: AnalyticsHostProject | null;
  /** The projects the top bar can switch to, in place. */
  switchTo?: readonly AnalyticsHostProject[];
  asLangyEditor?: boolean;
}) {
  const calls: UiProcedureCall[] = [];
  const host = hostIn(projectInView ?? undefined, asLangyEditor ? LANGY_EDITOR : {});
  const hosts = [host, ...switchTo.map((project) => hostIn(project))];
  const respond = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "boards.resolve") {
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }
    if (call.path === "featureFlag.isEnabledForEachOrganization") {
      return Promise.resolve({ enabledByOrganizationId: { "org-1": true } });
    }
    if (call.path === "boards.getAll") return Promise.resolve([{ ...LISTED_IN_SHOP, homeProduct }]);
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    if (call.path === "dashboardWidgets.list") return Promise.resolve([]);
    return NO_PROCEDURES(call);
  };
  const element = (
    <TopBarProjectSwitch hosts={hosts}>
      <OrganizationBoardScreen />
    </TopBarProjectSwitch>
  );
  renderDashboards({ element, host, answer: respond });
  return { host, hosts, calls, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

/** The projects the board's lists were read in, in order, once each. */
const listReadProjects = (calls: readonly UiProcedureCall[]) => [
  ...new Set(
    calls
      .filter((call) => call.path === "boards.getAll")
      .map((call) => (call.input as { projectId: string }).projectId),
  ),
];

const UNAVAILABLE = "This dashboard was deleted or isn't shared with you.";

describe("a board opened at /dashboards/<id>", () => {
  describe("when it is a Project board of a project the member reads", () => {
    /** @scenario "A Project board opens at its org-level address" */
    it("opens it there, in its project, without leaving Dashboards", async () => {
      const { host } = renderBoard({
        answer: resolved({ id: "board-org", scope: "PROJECT", project: SHOP }),
      });

      expect(await screen.findByRole("heading", { name: "Everyone's board" })).toBeInTheDocument();
      expect(await screen.findByLabelText(`Data from ${SHOP.name}`)).toBeVisible();
      expect(host.replacements).toEqual([]);
      expect(host.navigations).toEqual([]);
    });
  });

  describe("when it is an empty board the member may edit", () => {
    describe("given it is homed in LLM Ops", () => {
      /** @scenario "Only an empty LLM Ops board offers templates" */
      it("offers every template, as the finder lists them", async () => {
        renderBoard({
          answer: resolved({ id: "board-org", scope: "PROJECT", project: SHOP }),
          asLangyEditor: true,
        });

        expect(await screen.findByText("Or start from a template")).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "What do you want to know?" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Where does my money go?" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add a widget" })).toBeInTheDocument();
        const start = within(screen.getByRole("region", { name: "Start from a template" }));
        expect(
          start
            .getAllByRole("button", { name: /^Use / })
            .map((each) => each.getAttribute("aria-label")),
        ).toEqual(finderPool({}).map(({ board }) => `Use ${board.name}`));
      });
    });

    describe("given it is homed in Gateway", () => {
      /** @scenario "Only an empty LLM Ops board offers templates" */
      it("offers no template, and keeps the ask bar, its questions and Add a widget", async () => {
        renderBoard({
          answer: resolved({
            id: "board-org",
            scope: "PROJECT",
            project: SHOP,
            homeProduct: "gateway",
          }),
          homeProduct: "gateway",
          projectInView: inView(SHOP),
          asLangyEditor: true,
        });

        expect(
          await screen.findByRole("button", { name: "Where does my money go?" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "What do you want to know?" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add a widget" })).toBeInTheDocument();
        expect(screen.queryByText("Or start from a template")).not.toBeInTheDocument();
      });
    });
  });

  describe("when the board is not one the member may see", () => {
    /** @scenario "A Project board of a project I cannot read is not available at org level" */
    it("says it is not available, names nothing of it, and goes back to the library", async () => {
      const { host, user } = renderBoard({
        answer: new UiProcedureRefusal("dashboard_not_found", 404),
      });

      expect(await screen.findByRole("heading", { name: UNAVAILABLE })).toBeVisible();
      expect(screen.queryByText("Everyone's board")).not.toBeInTheDocument();
      expect(host.replacements).toEqual([]);
      await user.click(screen.getByRole("link", { name: "Back to Dashboards" }));
      expect(host.navigations).toEqual(["/dashboards"]);
    });
  });

  describe("when the read fails for any other reason", () => {
    // A refusal the query layer does not retry, so the page answers at once.
    it("shows the failure with Retry, not the not-available page", async () => {
      renderBoard({ answer: new UiProcedureRefusal("forbidden", 403) });

      expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
      expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
    });
  });

  describe("when no project of the organization has Dashboards on", () => {
    it("answers the app's not-found page", async () => {
      renderBoard({ answer: new UiProcedureRefusal("dashboards_not_enabled", 403) });

      expect(await screen.findByRole("heading", { name: "This page is not here" })).toBeVisible();
    });
  });

  describe("when it is an LLM Ops Organization board and no project is in view", () => {
    /** @scenario "An LLM Ops Organization board with no project in view reads the project it opens in" */
    it("opens it at that address, read in the project the board opens in", async () => {
      const { host, calls } = renderBoard({
        answer: resolved({
          id: "board-org",
          scope: "ORGANIZATION",
          project: null,
          openProject: SHOP,
        }),
        projectInView: null,
      });

      const heading = await screen.findByRole("heading", { name: "Everyone's board" });
      expect(heading).toBeInTheDocument();
      expect(listReadProjects(calls)).toEqual([SHOP.id]);
      expect(await screen.findByLabelText(`Data from ${SHOP.name}`)).toBeVisible();
      expect(host.navigations).toEqual([]);
    });
  });

  describe("when it is an LLM Ops Organization board and a project is in view (D2)", () => {
    const organizationBoard = resolved({ id: "board-org", scope: "ORGANIZATION", project: SHOP });

    /** @scenario "An LLM Ops Organization board reads the project in view, with no switcher on the board" */
    it("reads the project in view, not its owner, and says so read-only", async () => {
      const { calls } = renderBoard({ answer: organizationBoard, projectInView: inView(OPS) });

      expect(await screen.findByLabelText(`Data from ${OPS.name}`)).toBeVisible();
      expect(screen.getByRole("heading", { name: "Everyone's board" })).toBeInTheDocument();
      expect(listReadProjects(calls)).toEqual([OPS.id]);
      expect(screen.queryByRole("button", { name: /^Project:/ })).not.toBeInTheDocument();
    });

    /** @scenario "Switching project keeps an LLM Ops Organization board open and re-reads it" */
    it("stays open in place when the top bar switches project, re-read there", async () => {
      const { hosts, calls, user } = renderBoard({
        answer: organizationBoard,
        projectInView: inView(OPS),
        switchTo: [inView(CHECKOUT)],
      });
      await screen.findByLabelText(`Data from ${OPS.name}`);

      await user.click(screen.getByRole("button", { name: `Switch to ${CHECKOUT.name}` }));

      expect(await screen.findByLabelText(`Data from ${CHECKOUT.name}`)).toBeVisible();
      expect(screen.getByRole("heading", { name: "Everyone's board" })).toBeInTheDocument();
      expect(listReadProjects(calls)).toEqual([OPS.id, CHECKOUT.id]);
      expect(hosts.flatMap((host) => [...host.navigations, ...host.replacements])).toEqual([]);
    });
  });

  describe("when it is a Project board and another project is in view", () => {
    /** @scenario "A Project board reads its own project, whatever project is in view" */
    it("draws its own project, whatever the top bar has in view", async () => {
      const { calls } = renderBoard({
        answer: resolved({ id: "board-org", scope: "PROJECT", project: SHOP }),
        projectInView: inView(OPS),
      });

      expect(await screen.findByLabelText(`Data from ${SHOP.name}`)).toBeVisible();
      expect(listReadProjects(calls)).toEqual([SHOP.id]);
    });
  });

  describe.each<DashboardHomeProduct>(["gateway", "governance"])(
    "when it is an Organization board homed in %s",
    (homeProduct) => {
      /** @scenario "A Gateway or Governance board names no project and ignores the project in view" */
      it("names no project, and ignores the project in view", async () => {
        const { calls } = renderBoard({
          answer: resolved({ id: "board-org", scope: "ORGANIZATION", project: SHOP, homeProduct }),
          homeProduct,
          projectInView: inView(OPS),
        });

        expect(
          await screen.findByRole("heading", { name: "Everyone's board" }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText(/^Data from /)).not.toBeInTheDocument();
        expect(listReadProjects(calls)).toEqual([SHOP.id]);
      });
    },
  );
});
