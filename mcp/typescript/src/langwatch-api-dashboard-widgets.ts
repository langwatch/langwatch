/**
 * One named LangWatchQL statement a widget may run, as the REST endpoint validates it
 * (`modules/dashboard/contract/src/dashboard-widget-rest.schemas.ts`).
 */
export interface DashboardWidgetQueryInput {
  name: string;
  sql: string;
  parameters?: {
    name: string;
    type: "string" | "number" | "boolean";
    default?: string | number | boolean;
  }[];
  /** The trace origins the query counts; `null` clears it back to the default, application. */
  sources?: WidgetSource[] | null;
}

/** A trace origin a widget query can count, as the platform's widget schema lists them. */
export type WidgetSource =
  | "application"
  | "simulation"
  | "evaluation"
  | "coding_agent"
  | "gateway"
  | "workflow"
  | "playground"
  | "langy"
  | "other";

/** Where a widget came from, as the platform records it. */
export type DashboardWidgetSource =
  | { kind: "catalogue"; catalogueId: string }
  | { kind: "langy" }
  | { kind: "code" }
  | { kind: "api" };

export interface DashboardWidgetDefinition {
  version: number;
  code: string;
  queries: DashboardWidgetQueryInput[];
  description?: string;
  prompt?: string;
  source?: DashboardWidgetSource;
}

export interface DashboardWidget {
  id: string;
  name: string;
  definition: DashboardWidgetDefinition;
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}
