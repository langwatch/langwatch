/**
 * How your own agent edits a widget instead of you: the REST call and the MCP tool call,
 * as the editor's API / MCP tab and the widget menu copy them. Pure.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

/** The MCP tool that changes one widget's name, code, queries or description. */
export const WIDGET_MCP_TOOL = "update_dashboard_widget";

/** The example edit both snippets make, so the two read as the same change. */
const EXAMPLE_EDIT = { name: "Errors per day", code: "<the widget code>" } as const;

/** Which widget, on which board, in which project. */
export interface WidgetRef {
  readonly projectId: string;
  readonly dashboardId: string;
  readonly widgetId: string;
}

/** A copy-ready curl call against this instance that renames the widget and replaces its code. */
export function widgetApiSnippet({
  origin,
  widget: { projectId, widgetId },
}: {
  /** Where this LangWatch answers, such as "https://app.langwatch.ai". */
  origin: string;
  widget: WidgetRef;
}): string {
  return [
    `curl -X PATCH "${origin}/api/v1/projects/${projectId}/analytics/dashboard-widgets/${widgetId}" \\`,
    `  -H "X-Auth-Token: $LANGWATCH_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${JSON.stringify(EXAMPLE_EDIT)}'`,
  ].join("\n");
}

/** The same edit as the MCP tool call your agent makes. */
export function widgetMcpSnippet({ dashboardId, widgetId }: WidgetRef): string {
  return JSON.stringify(
    { tool: WIDGET_MCP_TOOL, arguments: { dashboardId, widgetId, ...EXAMPLE_EDIT } },
    null,
    2,
  );
}
