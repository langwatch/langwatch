import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type GatewayBudget,
  GatewayBudgetsApiError,
  GatewayBudgetsApiService,
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

const budget = (
  id: string,
  overrides: Partial<GatewayBudget> = {},
): GatewayBudget => ({
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
  cycle_anchor_at: null,
  last_reset_at: null,
  archived_at: null,
  created_at: "2026-06-01T00:00:00.000Z",
  ...overrides,
});

const page = (
  ids: string[],
  next_cursor: string | null,
  spend_available = true,
): unknown => ({
  data: ids.map((id) =>
    budget(
      id,
      // Mirrors the server: a page it could not total serves both spend
      // fields as null rather than a stale figure.
      spend_available ? {} : { spent_usd: null, spent_nano_usd: null },
    ),
  ),
  spend_available,
  next_cursor,
});

/** The query string of the nth fetch, in call order. */
const queryOf = (call: number): string => {
  const url = String(mockFetch.mock.calls[call]![0]);
  return url.slice(url.indexOf("?") + 1);
};

/** Reads an iterator to exhaustion and hands back every row it yielded. */
const drain = async <T>(rows: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
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
    if (previousProjectId === undefined)
      delete process.env.LANGWATCH_PROJECT_ID;
    else process.env.LANGWATCH_PROJECT_ID = previousProjectId;
  });

  describe("list()", () => {
    it("follows the cursor across pages and stops when it comes back null", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a", "b"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["c", "d"], "cursor-2")))
        .mockResolvedValueOnce(jsonResponse(page(["e"], null)));

      const result = await new GatewayBudgetsApiService().list();

      expect(result.map((b) => b.id)).toEqual(["a", "b", "c", "d", "e"]);
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

    it("leaves the unreadable spend visible on the rows when a page could not total it", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "cursor-1", true)))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null, false)));

      const result = await new GatewayBudgetsApiService().list();

      // The envelope is gone, but nothing is lost: a page that could not
      // total spend serves a null `spent_usd`, so the rows carry the signal.
      expect(result).toHaveLength(2);
      expect(result.some((b) => b.spent_usd === null)).toBe(true);
    });

    it("stops after one request against a server that sends no cursor at all", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [budget("a")], spend_available: true }),
      );

      const result = await new GatewayBudgetsApiService().list();

      expect(result.map((b) => b.id)).toEqual(["a"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("raises rather than truncating when the cursor chain never ends", async () => {
      // A fresh Response per call: a body can only be read once.
      mockFetch.mockImplementation(() =>
        Promise.resolve(jsonResponse(page(["a"], "stuck"))),
      );

      await expect(
        new GatewayBudgetsApiService().list(),
      ).rejects.toBeInstanceOf(GatewayBudgetsApiError);
    });

    it("resumes from a caller's cursor and still walks to the end", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["c"], "cursor-3")))
        .mockResolvedValueOnce(jsonResponse(page(["d"], null)));

      const result = await new GatewayBudgetsApiService().list({
        cursor: "cursor-2",
      });

      expect(new URLSearchParams(queryOf(0)).get("cursor")).toBe("cursor-2");
      expect(result.map((b) => b.id)).toEqual(["c", "d"]);
    });
  });

  describe("iterate()", () => {
    it("yields rows across pages without collecting the listing first", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a", "b"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["c"], null)));

      const ids: string[] = [];
      for await (const b of new GatewayBudgetsApiService().iterate()) {
        ids.push(b.id);
      }

      expect(ids).toEqual(["a", "b", "c"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("reads a page only when the consumer reaches it", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a", "b"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["c"], null)));

      const rows = new GatewayBudgetsApiService().iterate();
      // Constructing the iterator asks for nothing at all.
      expect(mockFetch).not.toHaveBeenCalled();

      await rows.next();
      // Both rows of page one are in hand, so page two is still unread.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await rows.next();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await rows.next();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("keeps the scope filter on every page of the walk", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null)));

      // Drain the walk; the assertion is on the requests it made.
      await drain(
        new GatewayBudgetsApiService().iterate({
          scopeTypes: ["project", "group"],
        }),
      );

      for (const call of [0, 1]) {
        expect(new URLSearchParams(queryOf(call)).get("scope_type")).toBe(
          "project,group",
        );
      }
    });

    it("raises rather than looping forever when the cursor chain never ends", async () => {
      // A fresh Response per call: a body can only be read once.
      mockFetch.mockImplementation(() =>
        Promise.resolve(jsonResponse(page(["a"], "stuck"))),
      );

      // The guard fires on the second page, long before this drains.
      await expect(
        drain(new GatewayBudgetsApiService().iterate()),
      ).rejects.toBeInstanceOf(GatewayBudgetsApiError);
    });
  });

  describe("listPage()", () => {
    it("takes exactly one page and hands back the cursor for the next", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(page(["a", "b"], "cursor-1")),
      );

      const result = await new GatewayBudgetsApiService().listPage({
        limit: 2,
      });

      expect(result.data.map((b) => b.id)).toEqual(["a", "b"]);
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
  describe("get()", () => {
    it("reads one budget by id and unwraps the envelope", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ budget: budget("b1"), spend_available: true }),
      );

      const result = await new GatewayBudgetsApiService().get("b1");

      expect(result.id).toBe("b1");
      expect(String(mockFetch.mock.calls[0]![0])).toContain(
        "/api/gateway/v1/budgets/b1",
      );
    });

    it("percent-encodes an id so it stays one path segment", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ budget: budget("a/b"), spend_available: true }),
      );

      await new GatewayBudgetsApiService().get("a/b");

      expect(String(mockFetch.mock.calls[0]![0])).toContain("budgets/a%2Fb");
    });
  });

  describe("filtering by your own identifier", () => {
    it("sends external_id as an exact-match query filter", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(page(["a"], null)));

      await new GatewayBudgetsApiService().listPage({ externalId: "acct-42" });

      expect(new URLSearchParams(queryOf(0)).get("external_id")).toBe(
        "acct-42",
      );
    });

    it("keeps the filter on EVERY page of an eager walk", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null)));

      await new GatewayBudgetsApiService().list({ externalId: "acct-42" });

      // A filter dropped after page one silently widens the answer.
      for (const call of [0, 1]) {
        expect(new URLSearchParams(queryOf(call)).get("external_id")).toBe(
          "acct-42",
        );
      }
    });

    it("keeps the filter on every page of a lazy walk too", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null)));

      await drain(
        new GatewayBudgetsApiService().iterate({ externalId: "acct-42" }),
      );

      for (const call of [0, 1]) {
        expect(new URLSearchParams(queryOf(call)).get("external_id")).toBe(
          "acct-42",
        );
      }
    });
  });
});
