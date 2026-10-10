/**
 * The board's widget editor is URL-routed, like "Add a widget": open while the address names
 * the widget (or "new"), so a reload or a re-mounted page keeps it open and Back closes it.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import { useAnalyticsHost } from "../../../model/analytics-host.ts";

export const WIDGET_EDITOR_QUERY_KEY = "editWidget";

export function useWidgetEditorAddress() {
  const host = useAnalyticsHost();
  const query = host.route().query;
  return {
    /** The widget id the editor is open on, "new" for a new widget, or undefined when closed. */
    target: query[WIDGET_EDITOR_QUERY_KEY],
    /** Opens the editor, closing what `closing` names (such as the picker) in the same write. */
    open: ({ target, closing = [] }: { target: string; closing?: readonly string[] }) =>
      host.setQuery({
        ...query,
        ...Object.fromEntries(closing.map((key) => [key, void 0])),
        [WIDGET_EDITOR_QUERY_KEY]: target,
      }),
    close: () => host.setQuery({ ...query, [WIDGET_EDITOR_QUERY_KEY]: void 0 }),
  };
}
