/**
 * The boards service's routes, verbs and bodies over /api/v1/boards, and the once-per-process
 * warning the dashboards service writes when the server marks /api/v1/dashboards deprecated.
 * Spec: modules/dashboard/specs/dashboards-v2.feature (AC199s)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DASHBOARDS_DEPRECATION_WARNING,
  resetDeprecationWarnings,
} from "@/client-sdk/services/_shared/deprecation-warning";
import { DashboardsApiService } from "@/client-sdk/services/dashboards/dashboards-api.service";
import type { LangwatchApiClient } from "@/internal/api/client";

import { BoardsApiService } from "../boards-api.service";

const ok = (data: unknown) => vi.fn(async () => ({ data, response: new Response(null) }));

describe("BoardsApiService", () => {
  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("calls each /api/v1/boards route with its verb, path and body", async () => {
    const client = {
      GET: ok({ data: [] }),
      POST: ok({ id: "b_1" }),
      PATCH: ok({ id: "b_1" }),
      DELETE: ok({ id: "b_1", name: "Usage" }),
    };
    const service = new BoardsApiService({
      langwatchApiClient: client as unknown as LangwatchApiClient,
    });
    const widget = { name: "Traces", code: "export default () => null;", queries: [] };

    await service.list();
    await service.get("b_1");
    await service.create({ name: "Usage" });
    await service.update({ boardId: "b_1", description: null });
    await service.delete("b_1");
    await service.listWidgets("b_1");
    await service.createWidget({ boardId: "b_1", widget });
    await service.getWidget({ boardId: "b_1", widgetId: "w_1" });
    await service.updateWidget({ boardId: "b_1", widgetId: "w_1", changes: { name: "P95" } });
    await service.deleteWidget({ boardId: "b_1", widgetId: "w_1" });

    const board = { params: { path: { boardId: "b_1" } } };
    const onBoard = { params: { path: { boardId: "b_1", widgetId: "w_1" } } };
    expect({
      GET: client.GET.mock.calls,
      POST: client.POST.mock.calls,
      PATCH: client.PATCH.mock.calls,
      DELETE: client.DELETE.mock.calls,
    }).toEqual({
      GET: [
        ["/api/v1/boards"],
        ["/api/v1/boards/{boardId}", board],
        ["/api/v1/boards/{boardId}/widgets", board],
        ["/api/v1/boards/{boardId}/widgets/{widgetId}", onBoard],
      ],
      POST: [
        ["/api/v1/boards", { body: { name: "Usage" } }],
        ["/api/v1/boards/{boardId}/widgets", { ...board, body: widget }],
      ],
      PATCH: [
        ["/api/v1/boards/{boardId}", { ...board, body: { description: null } }],
        ["/api/v1/boards/{boardId}/widgets/{widgetId}", { ...onBoard, body: { name: "P95" } }],
      ],
      DELETE: [
        ["/api/v1/boards/{boardId}", board],
        ["/api/v1/boards/{boardId}/widgets/{widgetId}", onBoard],
      ],
    });
  });
});

describe("DashboardsApiService, given the server's Deprecation header", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetDeprecationWarnings();
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  const serviceAnswering = (headers: Record<string, string>) =>
    new DashboardsApiService({
      langwatchApiClient: {
        GET: vi.fn(async () => ({ data: { data: [] }, response: new Response(null, { headers }) })),
      } as unknown as LangwatchApiClient,
    });

  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("writes one warning naming /api/v1/boards to stderr, however many calls", async () => {
    const service = serviceAnswering({
      Deprecation: "true",
      Link: '</api/v1/boards>; rel="successor-version"',
    });

    const listed = await service.list();
    await service.list();

    expect(listed).toEqual({ data: [] });
    expect(stderr.mock.calls).toEqual([[`${DASHBOARDS_DEPRECATION_WARNING}\n`]]);
    expect(DASHBOARDS_DEPRECATION_WARNING).toContain("/api/v1/boards");
    expect(DASHBOARDS_DEPRECATION_WARNING).toContain("langwatch boards");
  });

  /** @scenario "AC199s Split: the CLI and MCP manage boards and warn on the deprecated route" */
  it("writes nothing when the answer carries no Deprecation header", async () => {
    await serviceAnswering({}).list();

    expect(stderr).not.toHaveBeenCalled();
  });
});
