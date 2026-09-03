import type { SseEventSourceConstructor, SseEventSourceLike } from "@langwatch/platform-api-client";
import superjson from "superjson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUiFeatureApiClient,
  UI_SSE_ENDPOINT_PREFIX,
  UI_TRPC_ENDPOINT,
} from "../src/behavior/ui-feature-transport";

/**
 * The third lane on this process's transport: the one a live procedure rides.
 *
 * The families still to move — traces, the experiments workbench, simulations
 * and the Langy layout — each open one of these and leave it open. A screen
 * whose subscription quietly took the request lane instead would render once
 * and then look like a page that simply had no news, so what is pinned here is
 * WHICH LANE an operation takes, not only that it works.
 *
 * The other pinned property is the session. There is no credential on this
 * channel: the browser attaches the reader's own cookie because the channel is
 * opened against the reader's own origin. Send it anywhere else and it is an
 * anonymous channel that still connects.
 */

class FakeChannel implements SseEventSourceLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closeCount = 0;

  constructor(
    readonly url: string,
    readonly init: { withCredentials?: boolean } | undefined,
  ) {}

  close(): void {
    this.readyState = 2;
    this.closeCount += 1;
  }

  accept(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  send(frame: unknown): void {
    this.onmessage?.({ data: superjson.stringify(frame) });
  }

  drop(): void {
    this.onerror?.({});
  }
}

type Wiring = {
  client: ReturnType<typeof createUiFeatureApiClient>;
  channels: FakeChannel[];
  requests: string[];
};

/** A transport whose two lanes both record what went down them. */
function transport(bodies: unknown[] = []): Wiring {
  const channels: FakeChannel[] = [];
  const requests: string[] = [];
  const queue = [...bodies];

  const eventSource = function (url: string, init?: { withCredentials?: boolean }) {
    const channel = new FakeChannel(url, init);
    channels.push(channel);
    return channel;
  } as unknown as SseEventSourceConstructor;

  const fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(JSON.stringify(queue.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  return { client: createUiFeatureApiClient({ fetch, eventSource }), channels, requests };
}

/** One tRPC result, in the shape the superjson-encoded transport sends back. */
function resultOf(data: unknown): unknown {
  return { result: { data: { json: data } } };
}

/**
 * Only the reconnect and teardown blocks take fake timers. The batching link
 * schedules its own flush on a timer, so freezing time for the request-lane
 * tests would hang them rather than speed them up.
 */
function frozenClock(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}

describe("given the browser process transport", () => {
  describe("when a screen watches a live procedure", () => {
    /** @scenario "Watching a procedure opens a live channel" */
    it("opens a live channel for it and sends no request", () => {
      const wiring = transport();

      wiring.client.subscription("traces.onTraceUpdate", { projectId: "project_1" }, {});

      expect(wiring.channels).toHaveLength(1);
      expect(wiring.requests).toEqual([]);
    });

    /** @scenario "What the screen is watching for travels with the channel" */
    it("addresses the channel to that procedure, carrying what was asked", () => {
      const wiring = transport();

      wiring.client.subscription("langy.onTurnStream", { turnId: "turn_1" }, {});

      const opened = new URL(wiring.channels[0]!.url);
      expect(opened.pathname).toBe(`${UI_SSE_ENDPOINT_PREFIX}langy.onTurnStream`);
      expect(superjson.parse(opened.searchParams.get("input") ?? "")).toEqual({
        turnId: "turn_1",
      });
    });
  });

  describe("when a screen reads a procedure", () => {
    /** @scenario "Reading a procedure still sends a request" */
    it("sends it as a request, opening no channel", async () => {
      const wiring = transport([[resultOf({ id: "prompt_1" })]]);

      const output = await wiring.client.query("prompts.getById", { id: "prompt_1" });

      expect(output).toEqual({ id: "prompt_1" });
      expect(wiring.requests).toHaveLength(1);
      expect(wiring.channels).toEqual([]);
    });

    /**
     * The subscription split now wraps the batching split, so a change to the
     * outer one can silently swallow the inner one's flag.
     */
    /** @scenario "Reads asked for their own connection still get one" */
    it("still honours a read that asked for its own connection", async () => {
      const wiring = transport([resultOf({ enabled: true }), [resultOf("other")]]);

      const outputs = await Promise.all([
        wiring.client.query(
          "featureFlag.isEnabled",
          { flag: "x" },
          { context: { skipBatch: true } },
        ),
        wiring.client.query("prompts.getAll", { projectId: "p" }),
      ]);

      expect(outputs).toEqual([{ enabled: true }, "other"]);
      expect(wiring.requests).toHaveLength(2);
      expect(wiring.requests.some((request) => !request.includes("batch=1"))).toBe(true);
    });
  });

  describe("when the channel's address decides whether the session travels", () => {
    /** @scenario "A live channel is opened against the application's own address" */
    it("opens it against the same origin the screen's reads resolve to", () => {
      const wiring = transport();

      wiring.client.subscription("traces.onTraceUpdate", { projectId: "project_1" }, {});

      const readsResolveTo = new URL(UI_TRPC_ENDPOINT, window.location.href).origin;
      expect(new URL(wiring.channels[0]!.url).origin).toBe(readsResolveTo);
    });

    /** @scenario "Nothing mints a credential for the channel" */
    it("carries no credential of its own onto the channel", () => {
      const wiring = transport();

      wiring.client.subscription("traces.onTraceUpdate", { projectId: "project_1" }, {});

      const opened = new URL(wiring.channels[0]!.url);
      expect([...opened.searchParams.keys()]).toEqual(["input"]);
      expect(wiring.channels[0]!.init).toEqual({});
    });
  });

  describe("when an update arrives on the channel", () => {
    /** @scenario "An update reaches the screen" */
    it("reaches the screen decoded the way the request lane decodes", () => {
      const wiring = transport();
      const seen: unknown[] = [];
      wiring.client.subscription(
        "traces.onTraceUpdate",
        { projectId: "project_1" },
        { onData: (value) => seen.push(value) },
      );
      wiring.channels[0]!.accept();

      wiring.channels[0]!.send({ event: "span_stored", at: new Date("2026-01-01T00:00:00Z") });

      expect(seen).toEqual([{ event: "span_stored", at: new Date("2026-01-01T00:00:00Z") }]);
    });
  });

  describe("when the channel keeps dropping", () => {
    frozenClock();

    /**
     * @scenario "A dropped channel is reopened after a short wait"
     * @scenario "Each further failure waits twice as long"
     */
    it("reopens it on the host's doubling wait", () => {
      const wiring = transport();
      wiring.client.subscription("traces.onTraceUpdate", { projectId: "project_1" }, {});

      for (const [index, wait] of [1000, 2000, 4000, 8000, 16_000].entries()) {
        wiring.channels[index]!.drop();
        vi.advanceTimersByTime(wait - 1);
        expect(wiring.channels).toHaveLength(index + 1);

        vi.advanceTimersByTime(1);
        expect(wiring.channels).toHaveLength(index + 2);
      }
    });

    /** @scenario "A channel that never comes back gives up rather than retrying forever" */
    it("gives up after the host's five attempts rather than retrying forever", () => {
      const wiring = transport();
      const errors: string[] = [];
      wiring.client.subscription(
        "traces.onTraceUpdate",
        { projectId: "project_1" },
        { onError: (error) => errors.push(error.message) },
      );

      for (const [index, wait] of [1000, 2000, 4000, 8000, 16_000].entries()) {
        wiring.channels[index]!.drop();
        vi.advanceTimersByTime(wait);
      }
      expect(wiring.channels).toHaveLength(6);

      wiring.channels[5]!.drop();
      vi.advanceTimersByTime(120_000);

      expect(errors).toEqual(["SSE connection failed after 5 attempts"]);
      expect(wiring.channels).toHaveLength(6);
    });
  });

  describe("when the screen stops watching", () => {
    frozenClock();

    /** @scenario "Stopping the watch closes the channel" */
    it("closes the channel it had open", () => {
      const wiring = transport();
      const watch = wiring.client.subscription(
        "traces.onTraceUpdate",
        { projectId: "project_1" },
        {},
      );
      wiring.channels[0]!.accept();

      watch.unsubscribe();

      expect(wiring.channels[0]!.closeCount).toBeGreaterThan(0);
    });

    /** @scenario "Stopping the watch cancels a reopen that has not happened yet" */
    it("opens nothing afterwards when a reopen was already scheduled", () => {
      const wiring = transport();
      const watch = wiring.client.subscription(
        "traces.onTraceUpdate",
        { projectId: "project_1" },
        {},
      );
      wiring.channels[0]!.accept();
      wiring.channels[0]!.drop();

      watch.unsubscribe();

      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(120_000);
      expect(wiring.channels).toHaveLength(1);
      expect(wiring.channels[0]!.closeCount).toBeGreaterThan(0);
    });
  });
});
