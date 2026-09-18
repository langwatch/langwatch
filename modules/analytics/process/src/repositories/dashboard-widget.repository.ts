import type { Instant } from "@langwatch/time";
import type { DashboardWidgetDefinition, DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";

/** A dashboard widget as every caller above this layer sees it. */
export interface DashboardWidget {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  /** Already parsed against the versioned schema — never raw `Json`. */
  readonly definition: DashboardWidgetDefinition;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  /** `null` when the widget is not on a dashboard — the playground page is not one. */
  readonly dashboardId: string | null;
  readonly gridColumn: number;
  readonly gridRow: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** The definition fields a create or update supplies. */
export interface DashboardWidgetDefinitionInput {
  readonly code: string;
  readonly queries: readonly DashboardWidgetQuery[];
}


export type DashboardWidgetRow = Omit<DashboardWidget, "definition"> & { readonly graph: unknown };
export interface DashboardWidgetScope { id: string; projectId: string }
export interface CreateDashboardWidgetInput {
  projectId: string;
  dashboardId?: string;
  input: { name: string } & DashboardWidgetDefinitionInput;
}
export interface UpdateDashboardWidgetInput extends DashboardWidgetScope {
  input: { name?: string } & Partial<DashboardWidgetDefinitionInput>;
}
export interface AssignDashboardWidgetInput extends DashboardWidgetScope { dashboardId: string }

export abstract class DashboardWidgetRepository {
  abstract findAll(input: { projectId: string }): Promise<DashboardWidgetRow[]>;
  abstract getById(input: DashboardWidgetScope): Promise<DashboardWidgetRow>;
  abstract createWidget(input: CreateDashboardWidgetInput): Promise<DashboardWidgetRow>;
  abstract updateWidget(input: UpdateDashboardWidgetInput): Promise<DashboardWidgetRow>;
  abstract deleteWidget(input: DashboardWidgetScope): Promise<void>;
  abstract assignToDashboard(input: AssignDashboardWidgetInput): Promise<DashboardWidgetRow>;
}
