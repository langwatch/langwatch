import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { scopedProjectId } from "@/internal/credentialContext";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";

/** A custom-chart-playground widget, exactly as the REST surface answers it. */
export type PlaygroundWidget =
  paths["/api/v1/projects/{projectId}/analytics/playground-widgets/{widgetId}"]["get"]["responses"]["200"]["content"]["application/json"];

/** One named LangWatchQL query a widget may run, as a create/update submits it. */
export type PlaygroundWidgetQueryInput =
  paths["/api/v1/projects/{projectId}/analytics/playground-widgets"]["post"]["requestBody"]["content"]["application/json"]["queries"][number];

/** The `{ code, queries }` a create or update submits. */
export interface PlaygroundWidgetDefinitionInput {
  code: string;
  queries: PlaygroundWidgetQueryInput[];
}

export class PlaygroundWidgetsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
    /**
     * The HTTP status the platform answered with, when the response was kept.
     * Without it the CLI's error reader can only guess `network_error` for a
     * failure the platform named precisely — same rationale as `ChartsApiError`.
     */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PlaygroundWidgetsApiError";
  }
}

/**
 * Typed client for the custom-chart-playground widget family
 * (`/api/v1/projects/{projectId}/analytics/playground-widgets`).
 *
 * The twin of {@link ChartsApiService} for the playground's own rows: same
 * project-in-path routes, same once-resolved project id (the CLI's
 * request-scoped project first, then `LANGWATCH_PROJECT_ID`), and the same
 * loud refusal when none is known rather than guessing.
 */
export class PlaygroundWidgetsApiService {
  private readonly apiClient: LangwatchApiClient;
  private readonly configuredProjectId: string | undefined;

  constructor(
    config?: Pick<InternalConfig, "langwatchApiClient"> & {
      projectId?: string;
    },
  ) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
    this.configuredProjectId = config?.projectId;
  }

  private handleApiError(
    operation: string,
    error: unknown,
    response?: Response,
  ): never {
    const status = response?.status ?? extractStatusFromResponse(error);
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: { status },
    });
    throwIfHandledError({ operation, error, response, message });
    throw new PlaygroundWidgetsApiError(message, operation, error, status);
  }

  private projectId(operation: string): string {
    const projectId =
      this.configuredProjectId ??
      scopedProjectId() ??
      process.env.LANGWATCH_PROJECT_ID;
    if (!projectId) {
      throw new PlaygroundWidgetsApiError(
        "No project is in scope. Pass --project <slug-or-id>, or set LANGWATCH_PROJECT_ID.",
        operation,
      );
    }
    return projectId;
  }

  async list(): Promise<{ data: PlaygroundWidget[] }> {
    const projectId = this.projectId("list playground widgets");
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/projects/{projectId}/analytics/playground-widgets",
      { params: { path: { projectId } } },
    );
    if (error) this.handleApiError("list playground widgets", error, response);
    return data as unknown as { data: PlaygroundWidget[] };
  }

  async get(id: string): Promise<PlaygroundWidget> {
    const projectId = this.projectId(`get playground widget "${id}"`);
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/projects/{projectId}/analytics/playground-widgets/{widgetId}",
      { params: { path: { projectId, widgetId: id } } },
    );
    if (error)
      this.handleApiError(`get playground widget "${id}"`, error, response);
    return data as unknown as PlaygroundWidget;
  }

  async create(params: {
    name: string;
    definition: PlaygroundWidgetDefinitionInput;
  }): Promise<PlaygroundWidget> {
    const projectId = this.projectId("create playground widget");
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/projects/{projectId}/analytics/playground-widgets",
      {
        params: { path: { projectId } },
        body: {
          name: params.name,
          code: params.definition.code,
          queries: params.definition.queries,
        },
      },
    );
    if (error)
      this.handleApiError("create playground widget", error, response);
    return data as unknown as PlaygroundWidget;
  }

  async update(
    id: string,
    params: { name?: string; definition?: PlaygroundWidgetDefinitionInput },
  ): Promise<PlaygroundWidget> {
    const projectId = this.projectId(`update playground widget "${id}"`);
    const { data, error, response } = await this.apiClient.PATCH(
      "/api/v1/projects/{projectId}/analytics/playground-widgets/{widgetId}",
      {
        params: { path: { projectId, widgetId: id } },
        body: {
          ...(params.name === undefined ? {} : { name: params.name }),
          ...(params.definition === undefined
            ? {}
            : {
                code: params.definition.code,
                queries: params.definition.queries,
              }),
        },
      },
    );
    if (error)
      this.handleApiError(`update playground widget "${id}"`, error, response);
    return data as unknown as PlaygroundWidget;
  }

  /** Adds a widget to a dashboard at the next free row, keeping its size. */
  async assignDashboard(
    id: string,
    params: { dashboardId: string },
  ): Promise<PlaygroundWidget> {
    const projectId = this.projectId(`pin playground widget "${id}"`);
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/projects/{projectId}/analytics/playground-widgets/{widgetId}/dashboard" as any,
      {
        params: { path: { projectId, widgetId: id } },
        body: { dashboardId: params.dashboardId },
      } as any,
    );
    if (error)
      this.handleApiError(`pin playground widget "${id}"`, error, response);
    return data as unknown as PlaygroundWidget;
  }

  /** Deletes a widget. The route answers `204` with no body. */
  async delete(id: string): Promise<void> {
    const projectId = this.projectId(`delete playground widget "${id}"`);
    const { error, response } = await this.apiClient.DELETE(
      "/api/v1/projects/{projectId}/analytics/playground-widgets/{widgetId}",
      { params: { path: { projectId, widgetId: id } } },
    );
    if (error)
      this.handleApiError(`delete playground widget "${id}"`, error, response);
  }
}
