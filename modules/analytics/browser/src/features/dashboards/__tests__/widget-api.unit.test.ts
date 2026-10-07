/**
 * How the member's own agent edits a widget: the REST call and the MCP tool call.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import { describe, expect, it } from "vitest";

import { WIDGET_MCP_TOOL, widgetApiSnippet, widgetMcpSnippet } from "../model/widget-api.ts";

const WIDGET = { projectId: "proj-1", dashboardId: "board-1", widgetId: "w-1" };

describe("given a saved widget", () => {
  /** @scenario "Widget editor: the API snippets name the real call and tool" */
  it("names the PATCH on this instance's project widget, with the member's API key", () => {
    const snippet = widgetApiSnippet({ origin: "https://lw.example.com", widget: WIDGET });

    expect(snippet).toContain(
      'curl -X PATCH "https://lw.example.com/api/v1/projects/proj-1/analytics/dashboard-widgets/w-1"',
    );
    expect(snippet).toContain('-H "X-Auth-Token: $LANGWATCH_API_KEY"');
    expect(snippet).toContain(`"name":"Errors per day"`);
    expect(snippet).toContain(`"code":"<the widget code>"`);
  });

  /** @scenario "Widget editor: the API snippets name the real call and tool" */
  it("calls update_dashboard_widget with the board and widget ids", () => {
    expect(JSON.parse(widgetMcpSnippet(WIDGET))).toEqual({
      tool: WIDGET_MCP_TOOL,
      arguments: {
        dashboardId: "board-1",
        widgetId: "w-1",
        name: "Errors per day",
        code: "<the widget code>",
      },
    });
    expect(WIDGET_MCP_TOOL).toBe("update_dashboard_widget");
  });
});
