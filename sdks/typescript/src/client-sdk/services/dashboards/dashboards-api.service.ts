import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { type InternalConfig } from "@/client-sdk/types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import type { paths } from "@/internal/generated/openapi/api-client";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;

/** A dashboard as `/api/v1/dashboards/{dashboardId}` answers it. */
export type Dashboard = Json<paths["/api/v1/dashboards/{dashboardId}"]["get"]["responses"]["200"]>;

/** One row of the dashboards list, with its widget count. */
export type DashboardListItem = Json<
  paths["/api/v1/dashboards"]["get"]["responses"]["200"]
>["data"][number];

/** A widget on a dashboard, as the dashboard's widget routes answer it. */
export type DashboardWidget = Json<
  paths["/api/v1/dashboards/{dashboardId}/widgets/{widgetId}"]["get"]["responses"]["200"]
>;

/** What creating a widget on a dashboard submits. */
export type CreateDashboardWidgetInput = NonNullable<
  paths["/api/v1/dashboards/{dashboardId}/widgets"]["post"]["requestBody"]
>["content"]["application/json"];

/** What updating a widget on a dashboard submits; a field left out keeps its value. */
export type UpdateDashboardWidgetInput = NonNullable<
  paths["/api/v1/dashboards/{dashboardId}/widgets/{widgetId}"]["patch"]["requestBody"]
>["content"]["application/json"];

export class DashboardsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DashboardsApiError";
  }
}

/**
 * Typed client for `/api/v1/dashboards`: the key's project's dashboards and the widgets on them.
 * The project comes from the API key; while Dashboards is off the routes answer 404.
 */
export class DashboardsApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError({
    operation,
    error,
    response,
  }: {
    operation: string;
    error: unknown;
    response?: Response;
  }): never {
    const status = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({ operation, error, options: { status } });
    throwIfHandledError({ operation, error, response, message });
    throw new DashboardsApiError(message, operation, error, status);
  }

  async list(): Promise<{ data: DashboardListItem[] }> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/dashboards");
    if (error) this.handleApiError({ operation: "list dashboards", error, response });
    return data as { data: DashboardListItem[] };
  }

  async get(dashboardId: string): Promise<Dashboard> {
    const operation = `get dashboard "${dashboardId}"`;
    const { data, error, response } = await this.apiClient.GET("/api/v1/dashboards/{dashboardId}", {
      params: { path: { dashboardId } },
    });
    if (error) this.handleApiError({ operation, error, response });
    return data as Dashboard;
  }

  async create({ name }: { name: string }): Promise<Dashboard> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/dashboards", {
      body: { name },
    });
    if (error) this.handleApiError({ operation: "create dashboard", error, response });
    return data as Dashboard;
  }

  /**
   * `description: null` clears it; a field left out keeps its value. `excludedOrigins: []`
   * includes Langy's traces, `["langy"]` leaves them out and `null` restores the default.
   */
  async update({
    dashboardId,
    name,
    description,
    excludedOrigins,
  }: {
    dashboardId: string;
    name?: string;
    description?: string | null;
    excludedOrigins?: string[] | null;
  }): Promise<Dashboard> {
    const operation = `update dashboard "${dashboardId}"`;
    const { data, error, response } = await this.apiClient.PATCH(
      "/api/v1/dashboards/{dashboardId}",
      {
        params: { path: { dashboardId } },
        body: {
          ...(name === undefined ? {} : { name }),
          ...(description === undefined ? {} : { description }),
          ...(excludedOrigins === undefined ? {} : { excludedOrigins }),
        },
      },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as Dashboard;
  }

  /** Deletes the dashboard with the widgets on it; answers its id and name. */
  async delete(dashboardId: string): Promise<{ id: string; name: string }> {
    const operation = `delete dashboard "${dashboardId}"`;
    const { data, error, response } = await this.apiClient.DELETE(
      "/api/v1/dashboards/{dashboardId}",
      {
        params: { path: { dashboardId } },
      },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as { id: string; name: string };
  }

  async listWidgets(dashboardId: string): Promise<{ data: DashboardWidget[] }> {
    const operation = `list widgets on dashboard "${dashboardId}"`;
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/dashboards/{dashboardId}/widgets",
      {
        params: { path: { dashboardId } },
      },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as { data: DashboardWidget[] };
  }

  /** Creates a widget placed on this dashboard. */
  async createWidget({
    dashboardId,
    widget,
  }: {
    dashboardId: string;
    widget: CreateDashboardWidgetInput;
  }): Promise<DashboardWidget> {
    const operation = `create widget on dashboard "${dashboardId}"`;
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/dashboards/{dashboardId}/widgets",
      { params: { path: { dashboardId } }, body: widget },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as DashboardWidget;
  }

  async getWidget({
    dashboardId,
    widgetId,
  }: {
    dashboardId: string;
    widgetId: string;
  }): Promise<DashboardWidget> {
    const operation = `get widget "${widgetId}" on dashboard "${dashboardId}"`;
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/dashboards/{dashboardId}/widgets/{widgetId}",
      { params: { path: { dashboardId, widgetId } } },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as DashboardWidget;
  }

  async updateWidget({
    dashboardId,
    widgetId,
    changes,
  }: {
    dashboardId: string;
    widgetId: string;
    changes: UpdateDashboardWidgetInput;
  }): Promise<DashboardWidget> {
    const operation = `update widget "${widgetId}" on dashboard "${dashboardId}"`;
    const { data, error, response } = await this.apiClient.PATCH(
      "/api/v1/dashboards/{dashboardId}/widgets/{widgetId}",
      { params: { path: { dashboardId, widgetId } }, body: changes },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as DashboardWidget;
  }

  /** The route answers `204` with no body. */
  async deleteWidget({
    dashboardId,
    widgetId,
  }: {
    dashboardId: string;
    widgetId: string;
  }): Promise<void> {
    const operation = `delete widget "${widgetId}" on dashboard "${dashboardId}"`;
    const { error, response } = await this.apiClient.DELETE(
      "/api/v1/dashboards/{dashboardId}/widgets/{widgetId}",
      { params: { path: { dashboardId, widgetId } } },
    );
    if (error) this.handleApiError({ operation, error, response });
  }
}
