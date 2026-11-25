/**
 * @vitest-environment jsdom
 * The board header's extension point: what a peer lends is drawn on a stored board and on a
 * From LangWatch board, and told which board it sits on; one that crashes is reported.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { type BoardHeaderActionProps, BoardHeaderActionToken } from "@langwatch/analytics-client";
import type { UiAnalytics } from "@langwatch/browser-host/analytics";
import { UiHostServicesContextProvider } from "@langwatch/browser-host/capabilities";
import { type UiLend, uiDeclarations } from "@langwatch/browser-host/declarations";
import {
  createUiHostServicesFromHost,
  RecordingUiAnalytics,
} from "@langwatch/browser-host/testing";
import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom loads no stylesheet, so the theme colours a chart frame is handed have no value to read.
vi.mock(import("@langwatch/design-system/color-mode"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRawColorValue: () => "#123456",
}));

import type { AnalyticsHostProject } from "../../../model/analytics-host.ts";
import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import { curatedBoardById } from "../model/curated-boards.ts";
import CuratedBoardScreen from "../ui/sections/curated-board.screen.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const BOARD = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Weekly review",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};
const WIDGETS = ["Traces", "Cost"].map((name, index) => ({
  id: `widget-${index + 1}`,
  dashboardId: "board-1",
  name,
  graph: {
    version: 1,
    code: "export default function Widget() { return null; }",
    queries: [{ name: "main", sql: "SELECT 1" }],
  },
  gridColumn: 0,
  gridRow: index * 3,
  colSpan: 4,
  rowSpan: 3,
}));

/** What a peer would lend: it prints what the header handed it. */
function LentProbe({ boardKind, boardId, boardName, widgetCount }: BoardHeaderActionProps) {
  return (
    <output aria-label="Lent action">
      {[boardKind, boardId, boardName, widgetCount ?? "loading"].join(" | ")}
    </output>
  );
}
const LENT: UiLend = {
  token: BoardHeaderActionToken,
  load: () => Promise.resolve({ default: LentProbe }),
};

const SHOP = { id: "proj-1", slug: "test-project", name: "Test Project", hasFirstMessage: true };
const OWNER = { id: "proj-owner", slug: "owner-abc", name: "Owner" };

/** A lent action with a bug: it throws while drawing. */
function CrashingAction(): never {
  throw new Error("The lent action broke");
}
const CRASHING: UiLend = {
  token: BoardHeaderActionToken,
  load: () => Promise.resolve({ default: CrashingAction }),
};

function openScreen({
  element,
  params,
  lends,
  board = {},
  organizationArea,
  project,
  analytics,
}: {
  element: ReactElement;
  params: Record<string, string>;
  lends: readonly UiLend[];
  /** Fields of the stored board that differ from the default board. */
  board?: Record<string, unknown>;
  /** The organization's Dashboards area flag, answered once given; unanswered when absent. */
  organizationArea?: boolean;
  project?: AnalyticsHostProject;
  analytics?: UiAnalytics;
}) {
  const host = new StubAnalyticsHost({
    flags: { release_dashboards: true },
    permissions: [...ANALYTICS_MEMBER_PERMISSIONS],
    route: { params, query: {} },
    ...(project ? { project } : {}),
  });
  const services = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    declarations: uiDeclarations([{ name: "insight", installation: { capabilities: {}, lends } }]),
    ...(analytics ? { analytics } : {}),
  };
  renderDashboards({
    element: (
      <UiHostServicesContextProvider value={services}>{element}</UiHostServicesContextProvider>
    ),
    host,
    answer: (call: UiProcedureCall) => {
      if (call.path === "featureFlag.isEnabledForEachOrganization") {
        return organizationArea === undefined
          ? NO_PROCEDURES(call)
          : Promise.resolve({ enabledByOrganizationId: { "org-1": organizationArea } });
      }
      if (call.path === "boards.scopeProjects") {
        return Promise.resolve({ ownerProject: OWNER, projects: [OWNER, SHOP] });
      }
      if (call.path === "boards.getAll") return Promise.resolve([{ ...BOARD, ...board }]);
      if (call.path === "boards.listStarred") return Promise.resolve([]);
      if (call.path === "dashboardWidgets.list") return Promise.resolve(WIDGETS);
      return NO_PROCEDURES(call);
    },
  });
}

afterEach(cleanup);

describe("given a module lends an action to the board header", () => {
  describe("when a member opens a stored board with 2 widgets", () => {
    /** @scenario "A board's header draws the action a peer lends it" */
    it("hands it the kind dashboard, the board's id, its name and its widget count", async () => {
      openScreen({
        element: <DashboardBoardScreen />,
        params: { dashboardId: "board-1" },
        lends: [LENT],
      });

      expect(
        await screen.findByText("dashboard | board-1 | Weekly review | 2"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add a widget" })).toBeInTheDocument();
    });
  });

  describe("when a member opens a From LangWatch board", () => {
    /** @scenario "A board's header draws the action a peer lends it" */
    it("hands it the kind template, the template's id and its widget count", async () => {
      const board = curatedBoardById("release")!;
      openScreen({
        element: <CuratedBoardScreen />,
        params: { templateId: "release" },
        lends: [LENT],
      });

      expect(
        await screen.findByText(`template | release | ${board.name} | ${board.widgets.length}`),
      ).toBeInTheDocument();
    });
  });
});

describe("given no module lends an action to the board header", () => {
  describe("when a member opens a board", () => {
    /** @scenario "A board's header draws the action a peer lends it" */
    it("draws the header with nothing more", async () => {
      openScreen({
        element: <CuratedBoardScreen />,
        params: { templateId: "release" },
        lends: [],
      });

      expect(await screen.findByRole("heading", { name: "Ready to ship?" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Lent action")).toBeNull();
    });
  });
});

describe("given the organization's Dashboards area is off", () => {
  describe("when a member opens a stored board", () => {
    /** @scenario "With the flag off, a board's title has no inline rename, as on main" */
    it("draws the title with no rename control", async () => {
      openScreen({
        element: <DashboardBoardScreen />,
        params: { dashboardId: "board-1" },
        lends: [],
        organizationArea: false,
      });

      const heading = await screen.findByRole("heading", { name: "Weekly review" });
      expect(within(heading).queryByRole("button")).toBeNull();
    });
  });

  describe("when a member opens an Organization board in a project", () => {
    /** @scenario "With the flag off, an Organization board keeps the Project chip, as on main" */
    it("shows the Project chip in place of the data label", async () => {
      openScreen({
        element: <DashboardBoardScreen />,
        params: { dashboardId: "board-1" },
        lends: [],
        board: { scope: "ORGANIZATION", projectId: OWNER.id },
        organizationArea: false,
        project: SHOP,
      });

      expect(
        await screen.findByRole("button", { name: `Project: ${SHOP.name}` }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Data from /)).toBeNull();
    });
  });

  describe("when the organization's Dashboards area is on", () => {
    /** @scenario "An Organization board in a project reads its data from a label, not a chip" */
    it("shows the data label, and no Project chip", async () => {
      openScreen({
        element: <DashboardBoardScreen />,
        params: { dashboardId: "board-1" },
        lends: [],
        board: { scope: "ORGANIZATION", projectId: OWNER.id },
        organizationArea: true,
        project: SHOP,
      });

      expect(await screen.findByLabelText(`Data from ${SHOP.name}`)).toBeVisible();
      expect(screen.queryByRole("button", { name: /^Project:/ })).toBeNull();
    });
  });
});

describe("given a module lends an action to the board header that crashes while drawing", () => {
  describe("when a member opens a stored board", () => {
    /** @scenario "Telemetry: a chart or a board header action that crashes while drawing is reported as an exception" */
    it("reports the crash once as an exception naming the lender and the board", async () => {
      const silenced = vi.spyOn(console, "error").mockImplementation(() => void 0);
      const analytics = new RecordingUiAnalytics();
      openScreen({
        element: <DashboardBoardScreen />,
        params: { dashboardId: "board-1" },
        lends: [CRASHING],
        analytics,
      });

      expect(await screen.findByText("This action failed to load")).toBeInTheDocument();
      expect(analytics.exceptions).toHaveLength(1);
      expect(analytics.exceptions[0]?.error).toEqual(new Error("The lent action broke"));
      expect(analytics.exceptions[0]?.properties).toEqual({
        surface: "board_header_action",
        owner: "insight",
        dashboardId: "board-1",
      });
      silenced.mockRestore();
    });
  });
});
