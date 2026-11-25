/**
 * Copies a widget's id, or the API call that edits it, for the member's own agent, and
 * says it did; a browser that refuses the clipboard is reported instead.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { widgetApiSnippet } from "../model/widget-api.ts";

export function useWidgetClipboard({ dashboardId }: { dashboardId: string }) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";

  const copy = async ({ text, what }: { text: string; what: string }) => {
    try {
      await navigator.clipboard.writeText(text);
      host.succeeded({ title: `${what} copied` });
    } catch (error) {
      host.failed({ error, fallbackTitle: `Couldn't copy the ${what.toLowerCase()}` });
    }
  };

  return {
    copyId: (widgetId: string) => void copy({ text: widgetId, what: "Widget id" }),
    copyApiSnippet: (widgetId: string) =>
      void copy({
        text: widgetApiSnippet({
          origin: window.location.origin,
          widget: { projectId, dashboardId, widgetId },
        }),
        what: "API snippet",
      }),
  };
}
