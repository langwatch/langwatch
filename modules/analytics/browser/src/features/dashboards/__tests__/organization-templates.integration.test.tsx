/**
 * @vitest-environment jsdom
 * The templates finder at the organization level, `/dashboards/templates`, against an in-memory
 * dashboards server: a template makes the member's own board in the store project, opened by id.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { finderPool } from "../model/template-library.ts";
import OrganizationTemplatesScreen from "../ui/sections/organization-templates.screen.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const TEMPLATE = finderPool({})[0]!.board;
/** Where the member may create, other than the project in view (`proj-1`) they may not. */
const STORE = { id: "proj-store", slug: "store-project", name: "Store project" };

/** Boards and widgets from memory, every call kept. */
function inMemoryServer() {
  const state = { calls: [] as UiProcedureCall[], boards: [] as { id: string; name: string }[] };
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    const input = (call.input ?? {}) as Record<string, unknown>;
    switch (call.path) {
      case "boards.getAll":
        return Promise.resolve(
          state.boards.map((board) => ({
            ...HOME_BOARD,
            ...board,
            description: null,
            createdById: "user-1",
            isStarred: false,
            updatedAt: new Date("2026-01-01"),
          })),
        );
      case "featureFlag.isEnabledForEachOrganization":
        return Promise.resolve({ enabledByOrganizationId: { "org-1": true } });
      case "boards.storeProjects":
        return Promise.resolve([STORE]);
      case "boards.listInOrganization":
        return Promise.resolve(
          state.boards.map((board) => ({
            ...board,
            description: null,
            createdById: "user-1",
            scope: "PRIVATE",
            updatedAt: new Date("2026-01-01"),
            project: STORE,
            openProject: STORE,
            starPosition: null,
            ownerName: null,
          })),
        );
      case "boards.create":
      case "boards.createAtScope": {
        const board = { id: `board-${state.boards.length + 1}`, name: String(input.name) };
        state.boards.push(board);
        return Promise.resolve(board);
      }
      case "boards.setScope":
      case "boards.update":
      case "dashboardWidgets.batchUpdateLayouts":
        return Promise.resolve({ success: true });
      case "dashboardWidgets.create":
        return Promise.resolve({ id: `widget-${state.calls.length}` });
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

function openTemplates() {
  const server = inMemoryServer();
  const host = new StubAnalyticsHost({
    flags: { release_dashboards: true },
    projectPermissions: { [STORE.id]: ["analytics:create", "analytics:update"] },
  });
  renderDashboards({ element: <OrganizationTemplatesScreen />, host, answer: server.answer });
  const inputsTo = (path: string) =>
    server.state.calls.filter((call) => call.path === path).map((call) => call.input);
  return { host, inputsTo, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

describe("the templates finder at the organization level", () => {
  /** @scenario "The Templates page at org level" */
  it("makes the member's own board in the store project, says so, and opens it by id", async () => {
    const { host, inputsTo, user } = openTemplates();

    await user.click(await screen.findByRole("button", { name: `Add ${TEMPLATE.name}` }));

    await waitFor(() => expect(host.navigations).toEqual(["/dashboards/board-1"]));
    expect(inputsTo("boards.createAtScope")).toEqual([
      { projectId: STORE.id, name: TEMPLATE.name, scope: "PRIVATE" },
    ]);
    expect(inputsTo("boards.setScope")).toEqual([]);
    expect(host.successes.map((notice) => notice.title)).toEqual([`Created "${TEMPLATE.name}"`]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  /** @scenario "The Templates page at org level" */
  it("numbers the name when the same template is added again", async () => {
    const { host, inputsTo, user } = openTemplates();

    await user.click(await screen.findByRole("button", { name: `Add ${TEMPLATE.name}` }));
    await waitFor(() => expect(host.navigations).toHaveLength(1));
    await user.click(await screen.findByRole("button", { name: `Add ${TEMPLATE.name}` }));

    await waitFor(() => expect(host.navigations).toHaveLength(2));
    const names = inputsTo("boards.createAtScope").map((input) => (input as { name: string }).name);
    expect(names).toEqual([TEMPLATE.name, `${TEMPLATE.name} 2`]);
  });
});
