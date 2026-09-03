import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  VirtualKeysApiError,
  VirtualKeysApiService,
  type VirtualKey,
} from "../virtual-keys-api.service";

/**
 * `GET /api/gateway/v1/virtual-keys` serves one page plus a cursor, and it
 * filters each page for visibility AFTER reading it. A short page therefore
 * says nothing about the end of the walk, which is why only a null cursor
 * stops it.
 */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const virtualKey = (id: string): VirtualKey => ({
  id,
  organization_id: "org_1",
  name: id,
  description: null,
  status: "active",
  purpose: "user",
  display_prefix: `vk-lw-${id}`,
  principal_user_id: null,
  trace_project_id: "proj_1",
  trace_project_archived: false,
  scopes: [{ scope_type: "project", scope_id: "proj_1" }],
  routing_policy_id: null,
  routing_mode: "none",
  config: {},
  revision: "1",
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
  last_used_at: null,
  revoked_at: null,
  expires_at: null,
});

const page = (ids: string[], next_cursor: string | null): unknown => ({
  data: ids.map(virtualKey),
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

describe("VirtualKeysApiService cursor paging", () => {
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
        .mockResolvedValueOnce(jsonResponse(page(["c"], "cursor-2")))
        .mockResolvedValueOnce(jsonResponse(page(["d", "e"], null)));

      const keys = await new VirtualKeysApiService().list();

      expect(keys.map((k) => k.id)).toEqual(["a", "b", "c", "d", "e"]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("keeps walking past a page the visibility filter left short", async () => {
      // limit=200 asked, one row survived the filter, and the cursor is not
      // null: stopping on the short page would drop everything after it.
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["b", "c"], null)));

      const keys = await new VirtualKeysApiService().list();

      expect(keys.map((k) => k.id)).toEqual(["a", "b", "c"]);
    });

    it("keeps walking past an EMPTY page that still carries a cursor", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page([], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["a"], null)));

      const keys = await new VirtualKeysApiService().list();

      expect(keys.map((k) => k.id)).toEqual(["a"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("passes each cursor back verbatim and asks for the wire's maximum page", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "op aq ue/+cursor")))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null)));

      await new VirtualKeysApiService().list();

      expect(queryOf(0)).toBe("limit=200");
      expect(new URLSearchParams(queryOf(1)).get("cursor")).toBe("op aq ue/+cursor");
    });

    it("stops after one request against a server that sends no cursor at all", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [virtualKey("a")] }));

      const keys = await new VirtualKeysApiService().list();

      expect(keys.map((k) => k.id)).toEqual(["a"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("raises rather than truncating when the cursor chain never ends", async () => {
      // A fresh Response per call: a body can only be read once.
      mockFetch.mockImplementation(() =>
        Promise.resolve(jsonResponse(page(["a"], "stuck"))),
      );

      await expect(new VirtualKeysApiService().list()).rejects.toBeInstanceOf(
        VirtualKeysApiError,
      );
    });
  });

  describe("iterate()", () => {
    it("yields keys across pages without collecting the listing first", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a", "b"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["c"], null)));

      const keys = await drain(new VirtualKeysApiService().iterate());

      expect(keys.map((k) => k.id)).toEqual(["a", "b", "c"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("reads a page only when the consumer reaches it", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a", "b"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["c"], null)));

      const keys = new VirtualKeysApiService().iterate();
      // Constructing the iterator asks for nothing at all.
      expect(mockFetch).not.toHaveBeenCalled();

      await keys.next();
      // Both rows of page one are in hand, so page two is still unread.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await keys.next();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await keys.next();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("leaves the rest of the walk unread when the consumer stops early", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(page(["a", "b"], "cursor-1")));

      const seen: string[] = [];
      for await (const key of new VirtualKeysApiService().iterate()) {
        seen.push(key.id);
        break;
      }

      expect(seen).toEqual(["a"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("asks for the wire's maximum page like the eager walk does", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(page(["a"], null)));

      await drain(new VirtualKeysApiService().iterate());

      expect(queryOf(0)).toBe("limit=200");
    });

    it("raises rather than looping forever when the cursor chain never ends", async () => {
      // A fresh Response per call: a body can only be read once.
      mockFetch.mockImplementation(() =>
        Promise.resolve(jsonResponse(page(["a"], "stuck"))),
      );

      // The guard fires on the second page, long before this drains.
      await expect(drain(new VirtualKeysApiService().iterate())).rejects.toBeInstanceOf(
        VirtualKeysApiError,
      );
    });
  });

  describe("listPage()", () => {
    it("takes exactly one page and hands back the cursor for the next", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(page(["a", "b"], "cursor-1")));

      const result = await new VirtualKeysApiService().listPage({ limit: 2 });

      expect(result.data.map((k) => k.id)).toEqual(["a", "b"]);
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
        new VirtualKeysApiService().listPage({ cursor: "made-up" }),
      ).rejects.toThrow(/cursor/i);
    });
  });
  describe("filtering by your own identifier", () => {
    it("sends external_id as an exact-match query filter", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(page(["a"], null)));

      await new VirtualKeysApiService().listPage({ externalId: "tenant-7" });

      expect(new URLSearchParams(queryOf(0)).get("external_id")).toBe("tenant-7");
    });

    it("keeps the filter on EVERY page of an eager walk", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null)));

      await new VirtualKeysApiService().list({ externalId: "tenant-7" });

      // A filter dropped after page one silently widens the answer.
      for (const call of [0, 1]) {
        expect(new URLSearchParams(queryOf(call)).get("external_id")).toBe("tenant-7");
      }
    });

    it("keeps the filter on every page of a lazy walk too", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page(["a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(page(["b"], null)));

      await drain(new VirtualKeysApiService().iterate({ externalId: "tenant-7" }));

      for (const call of [0, 1]) {
        expect(new URLSearchParams(queryOf(call)).get("external_id")).toBe("tenant-7");
      }
    });
  });
});
