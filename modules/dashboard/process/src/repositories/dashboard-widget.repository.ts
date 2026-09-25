import type { DashboardWidgetDefinitionInput } from "@langwatch/analytics-contract";
import type { GraphLayout } from "@langwatch/dashboard-contract";
import type { Instant } from "@langwatch/time";

/** The stored CustomGraph representation, before its JSON definition is parsed. */
export interface DashboardWidgetRow {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly graph: unknown;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly dashboardId: string | null;
  readonly gridColumn: number;
  readonly gridRow: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

export interface DashboardWidgetScope {
  readonly id: string;
  readonly projectId: string;
}

export interface CreateDashboardWidgetInput {
  readonly id: string;
  readonly projectId: string;
  readonly dashboardId?: string;
  readonly input: { readonly name: string } & DashboardWidgetDefinitionInput;
}

export interface UpdateDashboardWidgetInput extends DashboardWidgetScope {
  readonly input: { readonly name?: string } & Partial<DashboardWidgetDefinitionInput>;
}

export interface AssignDashboardWidgetInput extends DashboardWidgetScope {
  readonly dashboardId: string;
}

export interface DashboardWidgetLayoutsInput {
  readonly projectId: string;
  readonly layouts: readonly { readonly graphId: string; readonly layout: GraphLayout }[];
}

export interface DashboardWidgetRepository {
  findAll(input: { projectId: string }): Promise<DashboardWidgetRow[]>;
  getById(input: DashboardWidgetScope): Promise<DashboardWidgetRow>;
  createWidget(input: CreateDashboardWidgetInput): Promise<DashboardWidgetRow>;
  updateWidget(input: UpdateDashboardWidgetInput): Promise<DashboardWidgetRow>;
  deleteWidget(input: DashboardWidgetScope): Promise<void>;
  assignToDashboard(input: AssignDashboardWidgetInput): Promise<DashboardWidgetRow>;
  /** All-or-nothing; an id naming no widget in the project is skipped, never refused. */
  updateLayouts(input: DashboardWidgetLayoutsInput): Promise<void>;
}
