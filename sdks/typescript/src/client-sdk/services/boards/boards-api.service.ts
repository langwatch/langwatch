import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { type InternalConfig } from "@/client-sdk/types";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import type { paths } from "@/internal/generated/openapi/api-client";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;

/** A Dashboards board as `/api/v1/dashboards/{dashboardId}` answers it. */
export type Board = Json<paths["/api/v1/dashboards/{dashboardId}"]["get"]["responses"]["200"]>;

/** One row of the boards list, with its widget count. */
export type BoardListItem = Json<
  paths["/api/v1/dashboards"]["get"]["responses"]["200"]
>["data"][number];

/** A widget on a board, as the board's widget routes answer it. */
export type BoardWidget = Json<
  paths["/api/v1/dashboards/{dashboardId}/widgets/{widgetId}"]["get"]["responses"]["200"]
>;

/** What creating a widget on a board submits. */
export type CreateBoardWidgetInput = NonNullable<
  paths["/api/v1/dashboards/{dashboardId}/widgets"]["post"]["requestBody"]
>["content"]["application/json"];

/** What updating a widget on a board submits; a field left out keeps its value. */
export type UpdateBoardWidgetInput = NonNullable<
  paths["/api/v1/dashboards/{dashboardId}/widgets/{widgetId}"]["patch"]["requestBody"]
>["content"]["application/json"];

export class BoardsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BoardsApiError";
  }
}

/**
 * Typed client for `/api/v1/dashboards`: the Dashboards boards of the key's project and the widgets
 * on them. The project comes from the API key; while Dashboards is off the routes answer 404.
 */
export class BoardsApiService {
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
    throw new BoardsApiError(message, operation, error, status);
  }

  async list(): Promise<{ data: BoardListItem[] }> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/dashboards");
    if (error) this.handleApiError({ operation: "list boards", error, response });
    return data as { data: BoardListItem[] };
  }

  async get(boardId: string): Promise<Board> {
    const operation = `get board "${boardId}"`;
    const { data, error, response } = await this.apiClient.GET("/api/v1/dashboards/{dashboardId}", {
      params: { path: { dashboardId: boardId } },
    });
    if (error) this.handleApiError({ operation, error, response });
    return data as Board;
  }

  async create({ name }: { name: string }): Promise<Board> {
    const { data, error, response } = await this.apiClient.POST("/api/v1/dashboards", {
      body: { name },
    });
    if (error) this.handleApiError({ operation: "create board", error, response });
    return data as Board;
  }

  /** `description: null` clears it; a field left out keeps its value. */
  async update({
    boardId,
    name,
    description,
  }: {
    boardId: string;
    name?: string;
    description?: string | null;
  }): Promise<Board> {
    const operation = `update board "${boardId}"`;
    const { data, error, response } = await this.apiClient.PATCH(
      "/api/v1/dashboards/{dashboardId}",
      {
        params: { path: { dashboardId: boardId } },
        body: {
          ...(name === undefined ? {} : { name }),
          ...(description === undefined ? {} : { description }),
        },
      },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as Board;
  }

  /** Deletes the board with the widgets on it; answers its id and name. */
  async delete(boardId: string): Promise<{ id: string; name: string }> {
    const operation = `delete board "${boardId}"`;
    const { data, error, response } = await this.apiClient.DELETE(
      "/api/v1/dashboards/{dashboardId}",
      {
        params: { path: { dashboardId: boardId } },
      },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as { id: string; name: string };
  }

  async listWidgets(boardId: string): Promise<{ data: BoardWidget[] }> {
    const operation = `list widgets on board "${boardId}"`;
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/dashboards/{dashboardId}/widgets",
      {
        params: { path: { dashboardId: boardId } },
      },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as { data: BoardWidget[] };
  }

  /** Creates a widget placed on this board. */
  async createWidget({
    boardId,
    widget,
  }: {
    boardId: string;
    widget: CreateBoardWidgetInput;
  }): Promise<BoardWidget> {
    const operation = `create widget on board "${boardId}"`;
    const { data, error, response } = await this.apiClient.POST(
      "/api/v1/dashboards/{dashboardId}/widgets",
      { params: { path: { dashboardId: boardId } }, body: widget },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as BoardWidget;
  }

  async getWidget({
    boardId,
    widgetId,
  }: {
    boardId: string;
    widgetId: string;
  }): Promise<BoardWidget> {
    const operation = `get widget "${widgetId}" on board "${boardId}"`;
    const { data, error, response } = await this.apiClient.GET(
      "/api/v1/dashboards/{dashboardId}/widgets/{widgetId}",
      { params: { path: { dashboardId: boardId, widgetId } } },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as BoardWidget;
  }

  async updateWidget({
    boardId,
    widgetId,
    changes,
  }: {
    boardId: string;
    widgetId: string;
    changes: UpdateBoardWidgetInput;
  }): Promise<BoardWidget> {
    const operation = `update widget "${widgetId}" on board "${boardId}"`;
    const { data, error, response } = await this.apiClient.PATCH(
      "/api/v1/dashboards/{dashboardId}/widgets/{widgetId}",
      { params: { path: { dashboardId: boardId, widgetId } }, body: changes },
    );
    if (error) this.handleApiError({ operation, error, response });
    return data as BoardWidget;
  }

  /** The route answers `204` with no body. */
  async deleteWidget({ boardId, widgetId }: { boardId: string; widgetId: string }): Promise<void> {
    const operation = `delete widget "${widgetId}" on board "${boardId}"`;
    const { error, response } = await this.apiClient.DELETE(
      "/api/v1/dashboards/{dashboardId}/widgets/{widgetId}",
      { params: { path: { dashboardId: boardId, widgetId } } },
    );
    if (error) this.handleApiError({ operation, error, response });
  }
}
