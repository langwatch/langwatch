/**
 * The organization's Dashboards library at `/dashboards`, rendered over the real tRPC hooks and
 * a transport the test answers; shared by the library's integration tests.
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";
import { Toaster } from "@langwatch/design-system/toaster";
import userEvent from "@testing-library/user-event";

import { StubAnalyticsHost, type StubAnalyticsHostOptions } from "../../../testing.tsx";
import DashboardsLibraryScreen from "../ui/sections/dashboards-library.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

export const SHOP = { id: "proj-shop", slug: "shop-abc123", name: "Shop" };
export const IN_VIEW = { id: "proj-1", slug: "test-project", name: "Test Project" };
/** A store project that sorts before the project in view by name. */
export const ALPHA = { id: "proj-alpha", slug: "alpha", name: "Alpha" };

type StoreProjects = readonly (typeof IN_VIEW)[];

/** One library row as `boards.listInOrganization` answers it; a Project board of "Shop". */
export const row = ({
  id,
  name,
  scope = "PROJECT",
  homeProduct = "llm-ops",
  project = SHOP,
  createdById = "someone",
  ownerName = null,
  description = null,
  updatedAt = "2026-11-01T00:00:00.000Z",
}: {
  id: string;
  name: string;
  scope?: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  homeProduct?: DashboardHomeProduct;
  project?: typeof SHOP | null;
  createdById?: string;
  ownerName?: string | null;
  description?: string | null;
  updatedAt?: string;
}) => ({
  id,
  name,
  description,
  createdById,
  ownerName,
  scope,
  homeProduct,
  updatedAt: new Date(updatedAt),
  project,
  openProject: project ?? IN_VIEW,
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

const answerOf = (value: unknown) =>
  value instanceof Error ? Promise.reject(value) : Promise.resolve(value);

/** Answers the library, the store projects and every write, echoing the board written. */
function libraryServer({
  listed = LISTED,
  storeProjects = [IN_VIEW],
}: {
  listed?: unknown;
  storeProjects?: StoreProjects | Error;
}) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "boards.listInOrganization") return answerOf(listed);
    if (call.path === "boards.getAll") return Promise.resolve([]);
    if (call.path === "boards.storeProjects") return answerOf(storeProjects);
    if (call.path === "boards.move") {
      const { dashboardId, homeProduct } = call.input as {
        dashboardId: string;
        homeProduct: DashboardHomeProduct;
      };
      const before = (Array.isArray(listed) ? listed : []).find(
        (board: { id: string }) => board.id === dashboardId,
      );
      const moved = before ?? row({ id: dashboardId, name: "Moved" });
      return Promise.resolve({ ...moved, homeProduct });
    }
    if (call.path === "boards.create" || call.path === "boards.createAtScope") {
      const { name } = call.input as { name: string };
      return Promise.resolve({ ...row({ id: "board-new", name }), projectId: IN_VIEW.id });
    }
    if (call.path === "dashboardWidgets.list") return Promise.resolve([]);
    if (call.path === "dashboardWidgets.batchUpdateLayouts") return Promise.resolve([]);
    if (call.path === "boards.delete") {
      const { dashboardId } = call.input as { dashboardId: string };
      return Promise.resolve(row({ id: dashboardId, name: "x" }));
    }
    if (call.path === "boards.update") {
      const { dashboardId, name } = call.input as { dashboardId: string; name: string };
      return Promise.resolve(row({ id: dashboardId, name }));
    }
    if (call.path === "boards.setScope") return Promise.resolve(row({ id: "x", name: "x" }));
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    return NO_PROCEDURES(call);
  };
  return { calls, answer };
}

/**
 * Renders the library with a toaster for a member who may edit and delete in "Shop" and create
 * in the project in view and "Alpha"; `listed` and `storeProjects` may each be a failure.
 */
export function renderLibrary({
  listed,
  storeProjects,
  ...options
}: StubAnalyticsHostOptions & {
  listed?: unknown;
  storeProjects?: StoreProjects | Error;
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

/** The inputs of every call to one procedure, in order. */
export const inputsTo = (calls: readonly UiProcedureCall[], path: string) =>
  calls.filter((call) => call.path === path).map((call) => call.input);
