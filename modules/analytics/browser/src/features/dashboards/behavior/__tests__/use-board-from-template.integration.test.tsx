/**
 * @vitest-environment jsdom
 * "Start from a template" against an in-memory dashboards and widgets server,
 * with a small template of its own so the real one can change freely.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import {
  type UiProcedureCall,
  UiProcedureRefusal,
} from "@langwatch/browser-host/testing-transport";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../../testing.tsx";
import {
  NO_PROCEDURES,
  renderDashboards,
} from "../../__tests__/render-dashboards.test-helpers.tsx";
import type { BoardTemplate } from "../../templates/index.ts";
import { useBoardFromTemplate } from "../use-board-from-template.ts";

const definition = (sql: string) => ({
  version: 1 as const,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "main", sql }],
});

const TEMPLATE: BoardTemplate = {
  id: "agent-flight-deck",
  name: "Small deck",
  description: "Two widgets side by side.",
  widgets: [
    {
      key: "left",
      name: "Left",
      definition: definition("SELECT 1"),
      layout: { gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 3 },
    },
    {
      key: "right",
      name: "Right",
      definition: definition("SELECT 2"),
      layout: { gridColumn: 4, gridRow: 0, colSpan: 4, rowSpan: 3 },
    },
  ],
};

/** Boards and widgets from memory; `refuseWidgets` answers every widget create with a refusal. */
function inMemoryServer({ refuseWidgets = false }: { refuseWidgets?: boolean } = {}) {
  const state = {
    calls: [] as UiProcedureCall[],
    boards: [] as { id: string }[],
    widgets: [] as { id: string; dashboardId: string; name: string }[],
  };
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    const input = (call.input ?? {}) as Record<string, unknown>;
    switch (call.path) {
      case "dashboards.create": {
        const board = { id: `board-${state.boards.length + 1}`, ...input };
        state.boards.push(board);
        return Promise.resolve(board);
      }
      case "dashboards.updateDetails":
      case "dashboardWidgets.batchUpdateLayouts":
        return Promise.resolve({ success: true });
      case "dashboards.delete":
        state.boards = state.boards.filter(({ id }) => id !== input.dashboardId);
        return Promise.resolve({ success: true });
      case "dashboardWidgets.create": {
        if (refuseWidgets) {
          return Promise.reject(new UiProcedureRefusal("dashboard_widget_definition_invalid", 422));
        }
        const widget = {
          id: `widget-${state.widgets.length + 1}`,
          dashboardId: String(input.dashboardId),
          name: String(input.name),
        };
        state.widgets.push(widget);
        return Promise.resolve(widget);
      }
      default:
        return NO_PROCEDURES(call);
    }
  };
  return { state, answer };
}

function TemplateButton({ existingNames }: { existingNames: string[] }) {
  const { creatingId, createFromTemplate } = useBoardFromTemplate();
  return (
    <button
      type="button"
      aria-busy={creatingId !== void 0}
      onClick={() => void createFromTemplate({ template: TEMPLATE, existingNames })}
    >
      Start from template
    </button>
  );
}

function startFromTemplate({
  server,
  existingNames = [],
}: {
  server: ReturnType<typeof inMemoryServer>;
  existingNames?: string[];
}) {
  const host = new StubAnalyticsHost({ flags: { release_dashboards: true } });
  renderDashboards({
    element: <TemplateButton existingNames={existingNames} />,
    host,
    answer: server.answer,
  });
  return host;
}

const inputsTo = (server: ReturnType<typeof inMemoryServer>, path: string) =>
  server.state.calls.filter((call) => call.path === path).map(({ input }) => input);

afterEach(cleanup);

describe("starting a board from a template", () => {
  describe("given no board has the template's name yet", () => {
    /** @scenario "AC8 Starting from the template makes a new board of editable widgets" */
    it("makes a board only the member sees, fills it, places it and opens it", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer();
      const host = startFromTemplate({ server });

      await user.click(screen.getByRole("button", { name: "Start from template" }));

      await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]));
      expect(inputsTo(server, "dashboards.create")).toEqual([
        { projectId: "proj-1", name: "Small deck", visibility: "only_me" },
      ]);
      expect(inputsTo(server, "dashboards.updateDetails")).toEqual([
        { projectId: "proj-1", dashboardId: "board-1", description: "Two widgets side by side." },
      ]);
      expect(inputsTo(server, "dashboardWidgets.create")).toEqual(
        TEMPLATE.widgets.map(({ name, definition: { code, queries } }) => ({
          projectId: "proj-1",
          dashboardId: "board-1",
          name,
          code,
          queries,
        })),
      );
      const byName = new Map(server.state.widgets.map(({ id, name }) => [name, id]));
      expect(inputsTo(server, "dashboardWidgets.batchUpdateLayouts")).toEqual([
        {
          projectId: "proj-1",
          layouts: TEMPLATE.widgets.map(({ name, layout }) => ({
            graphId: byName.get(name),
            ...layout,
          })),
        },
      ]);
      expect(host.failures).toEqual([]);
    });
  });

  describe("given boards already carry the template's name", () => {
    /** @scenario "AC8 Starting from the template makes a new board of editable widgets" */
    it("numbers the new board after the last one taken", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer();
      startFromTemplate({ server, existingNames: ["Small deck", "Small deck 2", "Weekly"] });

      await user.click(screen.getByRole("button", { name: "Start from template" }));

      await waitFor(() =>
        expect(inputsTo(server, "dashboards.create")).toEqual([
          { projectId: "proj-1", name: "Small deck 3", visibility: "only_me" },
        ]),
      );
    });
  });

  describe("given the server refuses a widget", () => {
    /** @scenario "AC8 Starting from the template makes a new board of editable widgets" */
    it("reports the refusal, removes the half-made board and stays where the member is", async () => {
      const user = userEvent.setup();
      const server = inMemoryServer({ refuseWidgets: true });
      const host = startFromTemplate({ server });

      await user.click(screen.getByRole("button", { name: "Start from template" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      await waitFor(() => expect(inputsTo(server, "dashboards.delete")).toHaveLength(1));
      expect(server.state.boards).toEqual([]);
      expect(host.navigations).toEqual([]);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Start from template" })).toHaveAttribute(
          "aria-busy",
          "false",
        ),
      );
    });
  });
});
