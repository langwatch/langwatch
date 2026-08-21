import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SpendEventsApiError,
  SpendEventsApiService,
  type SpendEvent,
  type SpendSummaryRow,
} from "../spend-events-api.service";

/**
 * The spend ledger is an unbounded ranged read, so this service offers pages
 * and a lazy walk and deliberately no eager whole-collection method: a
 * reconciler that stops on the first page under-counts the window, and one
 * that materialises the window runs out of memory instead.
 */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const spendEvent = (id: string): SpendEvent => ({
  id,
  type: "gateway.request.completed",
  created: "2026-07-01T00:00:00.000Z",
  schema_version: "1",
  data: {
    event_id: `${id}:completed`,
    event_type: "gateway.request.completed",
    gateway_request_id: id,
    occurred_at: "2026-07-01T00:00:00.000Z",
    organization_id: "org_1",
    project_id: "proj_1",
    virtual_key_id: "vk_1",
    principal_user_id: null,
    end_user_id: null,
    trace_id: `trace_${id}`,
    model: "gpt-4o-mini",
    model_provider_id: "openai",
    request_type: "chat",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_tokens: 0,
    },
    cost: { total_usd: "0.001", nano_usd: 1_000_000, rate_version: null },
    status: "success",
    needs_reconciliation: null,
    settle_reason: null,
    error: null,
    duration_ms: 120,
    labels: [],
    metadata: {},
  },
});

const summaryRow = (key: string): SpendSummaryRow => ({
  key,
  group: { virtual_key: key },
  bucket_start: null,
  event_count: 3,
  settled_count: 1,
  usage: {
    input_tokens: 30,
    output_tokens: 15,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_tokens: 0,
  },
  cost: { total_usd: "0.003", nano_usd: 3_000_000 },
});

const eventsPage = (ids: string[], next_cursor: string | null): unknown => ({
  data: ids.map(spendEvent),
  next_cursor,
});

const summariesPage = (
  keys: string[],
  next_cursor: string | null,
): unknown => ({ data: keys.map(summaryRow), next_cursor });

/** The query string of the nth fetch, in call order. */
const queryOf = (call: number): string => {
  const url = String(mockFetch.mock.calls[call]![0]);
  return url.slice(url.indexOf("?") + 1);
};

/** Reads an iterator to exhaustion and hands back every row it yielded. */
const drain = async <T,>(rows: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
};

const WINDOW = { from: 1_750_000_000_000, to: 1_750_086_400_000 };

describe("SpendEventsApiService cursor paging", () => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;
  const previousEndpoint = process.env.LANGWATCH_ENDPOINT;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.LANGWATCH_API_KEY = "sk-lw-test";
    process.env.LANGWATCH_ENDPOINT = "https://api.langwatch.test";
  });

  afterEach(() => {
    if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = previousApiKey;
    if (previousEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
    else process.env.LANGWATCH_ENDPOINT = previousEndpoint;
  });

  describe("listPage()", () => {
    it("takes exactly one page and hands back the cursor for the next", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(eventsPage(["req_a", "req_b"], "cursor-1")),
      );

      const page = await new SpendEventsApiService().listPage({
        ...WINDOW,
        limit: 2,
      });

      expect(page.data.map((e) => e.id)).toEqual(["req_a", "req_b"]);
      expect(page.next_cursor).toBe("cursor-1");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const query = new URLSearchParams(queryOf(0));
      expect(query.get("from")).toBe(String(WINDOW.from));
      expect(query.get("to")).toBe(String(WINDOW.to));
      expect(query.get("limit")).toBe("2");
    });

    it("sends every filter as its snake_case query param", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(eventsPage([], null)));

      await new SpendEventsApiService().listPage({
        ...WINDOW,
        virtualKeyId: "vk_1",
        endUserId: "user_1",
        projectId: "proj_1",
        model: "gpt-4o-mini",
        status: "error",
      });

      const query = new URLSearchParams(queryOf(0));
      expect(query.get("virtual_key_id")).toBe("vk_1");
      expect(query.get("end_user_id")).toBe("user_1");
      expect(query.get("project_id")).toBe("proj_1");
      expect(query.get("model")).toBe("gpt-4o-mini");
      expect(query.get("status")).toBe("error");
    });

    it("surfaces a rejected cursor as an error instead of restarting the walk", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              type: "bad_request",
              code: "invalid_cursor",
              message: "`cursor` is not a cursor this endpoint issued.",
            },
          },
          400,
        ),
      );

      await expect(
        new SpendEventsApiService().listPage({ ...WINDOW, cursor: "made-up" }),
      ).rejects.toThrow(/cursor/i);
    });
  });

  describe("iterate()", () => {
    it("yields events across pages and stops when the cursor comes back null", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(eventsPage(["req_a"], "cursor-1")))
        .mockResolvedValueOnce(
          jsonResponse(eventsPage(["req_b", "req_c"], null)),
        );

      const events = await drain(new SpendEventsApiService().iterate(WINDOW));

      expect(events.map((e) => e.id)).toEqual(["req_a", "req_b", "req_c"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("reads a page only when the consumer reaches it", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(eventsPage(["req_a", "req_b"], "cursor-1")),
        )
        .mockResolvedValueOnce(jsonResponse(eventsPage(["req_c"], null)));

      const events = new SpendEventsApiService().iterate(WINDOW);
      expect(mockFetch).not.toHaveBeenCalled();

      await events.next();
      await events.next();
      // Both rows of page one are in hand, so page two is still unread.
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await events.next();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("keeps the window and the filters on every page of the walk", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(eventsPage(["req_a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(eventsPage(["req_b"], null)));

      await drain(
        new SpendEventsApiService().iterate({ ...WINDOW, model: "claude" }),
      );

      for (const call of [0, 1]) {
        const query = new URLSearchParams(queryOf(call));
        expect(query.get("from")).toBe(String(WINDOW.from));
        expect(query.get("to")).toBe(String(WINDOW.to));
        expect(query.get("model")).toBe("claude");
        // The walk asks for the wire's maximum page, not the server default.
        expect(query.get("limit")).toBe("200");
      }
      expect(new URLSearchParams(queryOf(1)).get("cursor")).toBe("cursor-1");
    });

    it("raises rather than looping forever when the cursor chain never ends", async () => {
      // A fresh Response per call: a body can only be read once.
      mockFetch.mockImplementation(() =>
        Promise.resolve(jsonResponse(eventsPage(["req_a"], "stuck"))),
      );

      await expect(
        drain(new SpendEventsApiService().iterate(WINDOW)),
      ).rejects.toBeInstanceOf(SpendEventsApiError);
    });
  });

  describe("summariesPage()", () => {
    it("takes exactly one page of rollups and hands back the cursor", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(summariesPage(["vk_a", "vk_b"], "cursor-1")),
      );

      const page = await new SpendEventsApiService().summariesPage({
        groupBy: "virtual_key",
        ...WINDOW,
      });

      expect(page.data.map((r) => r.key)).toEqual(["vk_a", "vk_b"]);
      expect(page.next_cursor).toBe("cursor-1");
      expect(new URLSearchParams(queryOf(0)).get("group_by")).toBe(
        "virtual_key",
      );
    });
  });

  describe("iterSummaries()", () => {
    it("yields every rollup row across the window's pages", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(summariesPage(["vk_a", "vk_b"], "cursor-1")),
        )
        .mockResolvedValueOnce(jsonResponse(summariesPage(["vk_c"], null)));

      const rows = await drain(
        new SpendEventsApiService().iterSummaries({
          groupBy: "end_user",
          ...WINDOW,
        }),
      );

      expect(rows.map((r) => r.key)).toEqual(["vk_a", "vk_b", "vk_c"]);
      for (const call of [0, 1]) {
        expect(new URLSearchParams(queryOf(call)).get("group_by")).toBe(
          "end_user",
        );
      }
    });

    it("keeps walking past a page the server left short", async () => {
      // A short page is not the end of the walk; only a null cursor is.
      mockFetch
        .mockResolvedValueOnce(jsonResponse(summariesPage(["vk_a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(summariesPage(["vk_b"], null)));

      const rows = await drain(
        new SpendEventsApiService().iterSummaries({
          groupBy: "virtual_key",
          ...WINDOW,
          limit: 50,
        }),
      );

      expect(rows.map((r) => r.key)).toEqual(["vk_a", "vk_b"]);
    });

    it("raises rather than looping forever when the cursor chain never ends", async () => {
      // A fresh Response per call: a body can only be read once.
      mockFetch.mockImplementation(() =>
        Promise.resolve(jsonResponse(summariesPage(["vk_a"], "stuck"))),
      );

      await expect(
        drain(
          new SpendEventsApiService().iterSummaries({
            groupBy: "virtual_key",
            ...WINDOW,
          }),
        ),
      ).rejects.toBeInstanceOf(SpendEventsApiError);
    });
  });
});
