import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  WebhooksApiError,
  WebhooksApiService,
  type EmittedEvent,
  type WebhookDeliveryRecord,
  type WebhookEndpointSummary,
} from "../webhooks-api.service";

/**
 * The webhook surface's request bodies are the wire's own shape, and both of
 * its logs are cursor-paged. Two things this pins down: a create body that
 * says `enabled_events` (a camelCase key would be dropped by the server's
 * validator), and a delivery read that carries the cursor instead of
 * truncating the log at the first page.
 */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const endpoint = (id: string): WebhookEndpointSummary => ({
  id,
  url: "https://acme.example/hooks",
  max_batch_size: 100,
  max_batch_delay_ms: 1_000,
  max_in_flight: 4,
  enabled_events: ["gateway.request.completed"],
  status: "active",
  disabled_reason: null,
  disabled_at: null,
  failing_since: null,
  last_success_at: null,
  last_failure_at: null,
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
});

const emittedEvent = (id: string): EmittedEvent => ({
  id,
  type: "gateway.request.completed",
  created: "2026-07-01T00:00:00.000Z",
  schema_version: "1",
  data: { gateway_request_id: id },
});

const delivery = (id: string): WebhookDeliveryRecord => ({
  id,
  dispatch_id: `dispatch_${id}`,
  attempt: 1,
  event_count: 2,
  outcome: "success",
  response_status: 200,
  latency_ms: 42,
  error: null,
  fired_at: "2026-07-01T00:00:00.000Z",
});

const eventsPage = (ids: string[], next_cursor: string | null): unknown => ({
  data: ids.map(emittedEvent),
  next_cursor,
});

const deliveriesPage = (ids: string[], next_cursor: string | null): unknown => ({
  data: ids.map(delivery),
  next_cursor,
});

/** The url of the nth fetch, in call order. */
const urlOf = (call: number): string => String(mockFetch.mock.calls[call]![0]);

/** The query string of the nth fetch, in call order. */
const queryOf = (call: number): string => {
  const url = urlOf(call);
  return url.slice(url.indexOf("?") + 1);
};

/** The nth fetch's RequestInit, in call order. */
const initOf = (call: number): RequestInit =>
  mockFetch.mock.calls[call]![1] as RequestInit;

/** The nth fetch's request body, parsed back from the JSON that was sent. */
const bodyOf = (call: number): Record<string, unknown> =>
  JSON.parse(initOf(call).body as string) as Record<string, unknown>;

/** Reads an iterator to exhaustion and hands back every row it yielded. */
const drain = async <T,>(rows: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
};

describe("WebhooksApiService", () => {
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

  describe("create()", () => {
    it("posts the body the wire takes, snake_case and untranslated", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: { ...endpoint("ep_1"), secret: "whsec_x" } }),
      );

      const created = await new WebhooksApiService().create({
        url: "https://acme.example/hooks",
        enabled_events: ["gateway.request.completed"],
        max_batch_size: 50,
        max_batch_delay_ms: 500,
        max_in_flight: 2,
      });

      expect(created.secret).toBe("whsec_x");
      expect(initOf(0).method).toBe("POST");
      const body = bodyOf(0);
      expect(body).toEqual({
        url: "https://acme.example/hooks",
        enabled_events: ["gateway.request.completed"],
        max_batch_size: 50,
        max_batch_delay_ms: 500,
        max_in_flight: 2,
      });
      expect(body).not.toHaveProperty("enabledEvents");
      // `description` is not in the route's body schema, so the server drops
      // it. Offering it in the type promised a field that silently vanished.
      expect(body).not.toHaveProperty("description");
    });
  });

  describe("update()", () => {
    it("patches the body the wire takes and sends nothing the caller omitted", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: endpoint("ep_1") }));

      await new WebhooksApiService().update("ep_1", {
        enabled_events: ["gateway.budget.breached"],
        max_batch_size: 10,
      });

      expect(initOf(0).method).toBe("PATCH");
      expect(bodyOf(0)).toEqual({
        enabled_events: ["gateway.budget.breached"],
        max_batch_size: 10,
      });
    });

    it("carries a status change on its own", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: { ...endpoint("ep_1"), status: "disabled" } }),
      );

      const updated = await new WebhooksApiService().update("ep_1", {
        status: "disabled",
      });

      expect(updated.status).toBe("disabled");
      expect(bodyOf(0)).toEqual({ status: "disabled" });
    });
  });

  describe("archive()", () => {
    it("retires the endpoint with a DELETE and returns nothing", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: { archived: true } }),
      );

      const result = await new WebhooksApiService().archive("ep_1");

      expect(result).toBeUndefined();
      expect(initOf(0).method).toBe("DELETE");
      expect(urlOf(0)).toBe(
        "https://api.langwatch.test/api/webhooks/v1/endpoints/ep_1",
      );
    });

    it("raises when the endpoint is not the caller's to archive", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              type: "not_found",
              code: "not_found",
              message: "Webhook endpoint not found.",
            },
          },
          404,
        ),
      );

      await expect(
        new WebhooksApiService().archive("ep_ghost"),
      ).rejects.toThrow(/not found/i);
    });
  });

  /** The created range the events log requires on every read. */
  const WINDOW = { from: 1_750_000_000_000, to: 1_750_086_400_000 } as const;

  describe("eventsPage()", () => {
    it("takes exactly one page and hands back the cursor for the next", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(eventsPage(["evt_a", "evt_b"], "cursor-1")),
      );

      const page = await new WebhooksApiService().eventsPage({
        type: "gateway.request.completed",
        from: 1_750_000_000_000,
        to: 1_750_086_400_000,
        limit: 2,
      });

      expect(page.data.map((e) => e.id)).toEqual(["evt_a", "evt_b"]);
      expect(page.next_cursor).toBe("cursor-1");
      const query = new URLSearchParams(queryOf(0));
      expect(query.get("type")).toBe("gateway.request.completed");
      expect(query.get("from")).toBe("1750000000000");
      expect(query.get("limit")).toBe("2");
    });

    it("reads a server that sends no cursor at all as an exhausted page", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: [emittedEvent("evt_a")] }),
      );

      const page = await new WebhooksApiService().eventsPage(WINDOW);

      expect(page.next_cursor).toBeNull();
    });
  });

  describe("iterEvents()", () => {
    it("yields events across pages and stops when the cursor comes back null", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(eventsPage(["evt_a"], "cursor-1")))
        .mockResolvedValueOnce(
          jsonResponse(eventsPage(["evt_b", "evt_c"], null)),
        );

      const events = await drain(new WebhooksApiService().iterEvents(WINDOW));

      expect(events.map((e) => e.id)).toEqual(["evt_a", "evt_b", "evt_c"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("keeps the type filter on every page and asks for the wire's maximum", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(eventsPage(["evt_a"], "cursor-1")))
        .mockResolvedValueOnce(jsonResponse(eventsPage(["evt_b"], null)));

      await drain(
        new WebhooksApiService().iterEvents({
          ...WINDOW,
          type: "gateway.request.settled",
        }),
      );

      for (const call of [0, 1]) {
        const query = new URLSearchParams(queryOf(call));
        expect(query.get("type")).toBe("gateway.request.settled");
        expect(query.get("limit")).toBe("200");
      }
      expect(new URLSearchParams(queryOf(1)).get("cursor")).toBe("cursor-1");
    });

    it("raises rather than looping forever when the cursor chain never ends", async () => {
      // A fresh Response per call: a body can only be read once.
      mockFetch.mockImplementation(() =>
        Promise.resolve(jsonResponse(eventsPage(["evt_a"], "stuck"))),
      );

      await expect(
        drain(new WebhooksApiService().iterEvents(WINDOW)),
      ).rejects.toBeInstanceOf(WebhooksApiError);
    });
  });

  describe("getEvent()", () => {
    it("reads one envelope back by id", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: emittedEvent("evt_a") }),
      );

      const event = await new WebhooksApiService().getEvent("evt a/1");

      expect(event.id).toBe("evt_a");
      expect(urlOf(0)).toBe(
        "https://api.langwatch.test/api/webhooks/v1/events/evt%20a%2F1",
      );
    });
  });

  describe("deliveriesPage()", () => {
    it("carries the cursor the log serves instead of dropping it", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(deliveriesPage(["dlv_a", "dlv_b"], "cursor-1")),
      );

      const page = await new WebhooksApiService().deliveriesPage("ep_1", {
        limit: 2,
      });

      expect(page.data.map((d) => d.id)).toEqual(["dlv_a", "dlv_b"]);
      expect(page.next_cursor).toBe("cursor-1");
      expect(new URLSearchParams(queryOf(0)).get("limit")).toBe("2");
    });

    it("passes a caller's cursor back verbatim", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(deliveriesPage(["dlv_c"], null)),
      );

      await new WebhooksApiService().deliveriesPage("ep_1", {
        cursor: "1750000000000~dlv_b",
      });

      expect(new URLSearchParams(queryOf(0)).get("cursor")).toBe(
        "1750000000000~dlv_b",
      );
    });
  });

  describe("iterDeliveries()", () => {
    it("walks the whole delivery log rather than its first page", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(deliveriesPage(["dlv_a", "dlv_b"], "cursor-1")),
        )
        .mockResolvedValueOnce(jsonResponse(deliveriesPage(["dlv_c"], null)));

      const deliveries = await drain(
        new WebhooksApiService().iterDeliveries("ep_1"),
      );

      expect(deliveries.map((d) => d.id)).toEqual(["dlv_a", "dlv_b", "dlv_c"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(new URLSearchParams(queryOf(1)).get("cursor")).toBe("cursor-1");
    });

    it("reads a page only when the consumer reaches it", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(deliveriesPage(["dlv_a", "dlv_b"], "cursor-1")),
        )
        .mockResolvedValueOnce(jsonResponse(deliveriesPage(["dlv_c"], null)));

      const deliveries = new WebhooksApiService().iterDeliveries("ep_1");
      expect(mockFetch).not.toHaveBeenCalled();

      await deliveries.next();
      await deliveries.next();
      // Both rows of page one are in hand, so page two is still unread.
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await deliveries.next();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("raises rather than looping forever when the cursor chain never ends", async () => {
      // A fresh Response per call: a body can only be read once.
      mockFetch.mockImplementation(() =>
        Promise.resolve(jsonResponse(deliveriesPage(["dlv_a"], "stuck"))),
      );

      await expect(
        drain(new WebhooksApiService().iterDeliveries("ep_1")),
      ).rejects.toBeInstanceOf(WebhooksApiError);
    });
  });
});
