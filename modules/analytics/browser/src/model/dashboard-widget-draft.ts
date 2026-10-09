import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";

/**
 * A widget's editable draft — a persisted definition's `code`/`queries` plus the name that
 * lives on `CustomGraph` itself, not in the `graph` column. Lives here (model, not the
 * editor) so a hook can depend on it without importing a `ui/sections` file.
 */
export interface DashboardWidgetDraft {
  name: string;
  code: string;
  queries: DashboardWidgetQuery[];
}
