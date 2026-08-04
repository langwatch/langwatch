import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  GatewayBudgetsApiError,
  GatewayBudgetsApiService,
  type GatewayBudget,
} from "../gateway-budgets-api.service";

/**
 * `GET /api/gateway/v1/budgets` serves one page plus a cursor. `list()` owes
 * its callers the whole listing anyway: `langwatch status` decides an all-clear
 * from it, and a breached budget on page two would turn into a green tick.
 */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const budget = (id: string, overrides: Partial<GatewayBudget> = {}): GatewayBudget => ({
  id,
  organization_id: "org_1",
  scope_type: "project",
  scope_id: "proj_1",
  name: id,
  description: null,
  window: "month",
  on_breach: "block",
  limit_usd: "100",
  limit_nano_usd: 100_000_000_000,
  spent_usd: "1",
  spent_nano_usd: 1_000_000_000,
  timezone: null,
  provider_key: null,
  current_period_started_at: "2026-07-01T00:00:00.000Z",
  resets_at: "2026-08-01T00:00:00.000Z",
  last_reset_at: null,
  archived_at: null,
  created_at: "2026-06-01T00:00:00.000Z",
  ...overrides,
});

const page = (
  ids: string[],
  next_cursor: string | null,
  spend_available = true,
): unknown => ({ data: ids.map((id) => budget(id)), spend_available, next_cursor });

/** The query string of the nth fetch, in call order. */
const queryOf = (call: number): string => {
  const url = String(mockFetch.mock.calls[call]![0]);
  return url.slice(url.indexOf("?") + 1);
};

describe("GatewayBudgetsApiService cursor paging", () => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;
  const previousEndpoint = process.env.LANGWATCH_ENDPOINT;
  const previousProjectId = process.env.LANGWATCH_PROJECT_ID;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.LANGWATCH_API_KEY = "sk-lw-test";
    process.env.LANGWATCH_ENDPOINT = "https://api.langwatch.test";
    delete process.env.LANGWATCH_PROJECT_ID;
  });

  afterEach(() => {
    if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = previousApiKey;
    if (previousEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
    else process.env.LANGWATCH_ENDPOINT = previousEndpoint;
    if (previousProjectId === undefined) delete process.env.LANGWATCH_PROJECT_ID;
    else process.env.LANGWATCH_PROJECT_ID = previousProjectId;
  });

  describe("list()", () => {
    it("follows the cursor across pages and stops when it comes back null", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a", "b"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["c", "d"], "cursor-2")))
        .mockResolvedValueOnce(jsonResponse(page(["e"], null)));

      const result = await new GatewayBudgetsApiService().list();

      expect(result.budgets.map((b) => b.id)).toEqual(["a", "b", "c", "d", "e"]);
      expect(result.next_cursor).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("passes each cursor back verbatim and asks for the wire's maximum page", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "op aq ue/+cursor")))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null)));

      await new GatewayBudgetsApiService().list();

      expect(queryOf(0)).toBe("limit=200");
      expect(new URLSearchParams(queryOf(1)).get("cursor")).toBe(
        "op aq ue/+cursor",
      );
    });

    it("keeps the scope filter on every page of the walk", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null)));

      await new GatewayBudgetsApiService().list({
        scopeTypes: ["project", "group"],
      });

      for (const call of [0, 1]) {
        expect(new URLSearchParams(queryOf(call)).get("scope_type")).toBe(
          "project,group",
        );
      }
    });

    it("reports spend as unavailable when any single page could not total it", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "cursor-1", true)))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null, false)));

      const result = await new GatewayBudgetsApiService().list();

      expect(result.spend_available).toBe(false);
      expect(result.budgets).toHaveLength(2);
    });

    it("stops after one request against a server that sends no cursor at all", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [budget("a")], spend_available: true }),
      );

      const result = await new GatewayBudgetsApiService().list();

      expect(result.budgets.map((b) => b.id)).toEqual(["a"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("raises rather than truncating when the cursor chain never ends", async () => {
      // A fresh Response per call: a body can only be read once.
      mockFetch.mockImplementation(() =>
        Promise.resolve(jsonResponse(page(["a"], "stuck"))),
      );

      await expect(new GatewayBudgetsApiService().list()).rejects.toBeInstanceOf(
        GatewayBudgetsApiError,
      );
    });

    it("resumes from a caller's cursor and still walks to the end", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["c"], "cursor-3")))
        .mockResolvedValueOnce(jsonResponse(page(["d"], null)));

      const result = await new GatewayBudgetsApiService().list({
        cursor: "cursor-2",
      });

      expect(new URLSearchParams(queryOf(0)).get("cursor")).toBe("cursor-2");
      expect(result.budgets.map((b) => b.id)).toEqual(["c", "d"]);
    });
  });

  describe("listPage()", () => {
    it("takes exactly one page and hands back the cursor for the next", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(page(["a", "b"], "cursor-1")));

      const result = await new GatewayBudgetsApiService().listPage({ limit: 2 });

      expect(result.budgets.map((b) => b.id)).toEqual(["a", "b"]);
      expect(result.next_cursor).toBe("cursor-1");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(new URLSearchParams(queryOf(0)).get("limit")).toBe("2");
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
        new GatewayBudgetsApiService().listPage({ cursor: "made-up" }),
      ).rejects.toThrow(/cursor/i);
    });
  });
});
