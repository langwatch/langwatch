import type { WidgetSource } from "./schemas/widget-sources.js";

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
  /** The trace origins the query counts; `null` makes it unset, counting application. */
  sources?: WidgetSource[] | null;
}

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
