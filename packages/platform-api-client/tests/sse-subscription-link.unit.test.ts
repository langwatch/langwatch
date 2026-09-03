import { createTRPCClient, getUntypedClient, type TRPCUntypedClient } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifySseFrame,
  SSE_SUBSCRIPTION_MAX_RECONNECT_ATTEMPTS,
  type SseEventSourceConstructor,
  type SseEventSourceLike,
  sseSubscriptionLink,
} from "../src/sse-subscription-link";

/**
 * The link that carries every live procedure. What it has to get right is not
 * the happy path — it is the four places a live channel goes quiet without
 * anyone noticing: a reconnect that never happens, a reconnect that never
 * stops, a domain failure mistaken for a dead channel, and a channel left open
 * after the screen unmounted. Each of those looks like a working page.
 *
 * The transport is a fake EventSource rather than a server, so a frame, a
 * drop and a reopen are all things this test can cause exactly when it wants.
 */

/** One live channel the link opened. */
class FakeEventSource implements SseEventSourceLike {
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

  /** The server accepted the connection. */
  accept(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** One `data:` frame arrives. */
  send(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** A frame arrives that is not a frame. */
  sendRaw(text: string): void {
    this.onmessage?.({ data: text });
  }

  /** The connection dropped. */
  drop(): void {
    this.onerror?.({});
  }
}

function channelRecorder(): {
  ctor: SseEventSourceConstructor;
  opened: FakeEventSource[];
} {
  const opened: FakeEventSource[] = [];
  const ctor = function (this: unknown, url: string, init?: { withCredentials?: boolean }) {
    const source = new FakeEventSource(url, init);
    opened.push(source);
    return source;
  } as unknown as SseEventSourceConstructor;
  return { ctor, opened };
}

/** JSON stands in for superjson: the link takes whichever the process chose. */
const jsonFrames = {
  stringify: (value: unknown) => JSON.stringify(value),
  parse: (text: string) => JSON.parse(text) as unknown,
};

type Watch = {
  client: TRPCUntypedClient<AnyRouter>;
  opened: FakeEventSource[];
  data: unknown[];
  errors: string[];
  started: number;
  completed: number;
};

function clientOver(
  options: { url?: string } = {},
): Omit<Watch, "data" | "errors" | "started" | "completed"> {
  const { ctor, opened } = channelRecorder();
  const client = createTRPCClient<AnyRouter>({
    links: [
      sseSubscriptionLink({
        url: options.url ?? "https://app.langwatch.test",
        transformer: jsonFrames,
        transformPath: (path) => `/api/sse/${path}`,
        eventSource: ctor,
      }),
    ],
  });
  return { client: getUntypedClient(client), opened };
}

function watch(
  path = "traces.onTraceUpdate",
  input: unknown = { projectId: "project_1" },
  options: { url?: string } = {},
): Watch & { stop: () => void } {
  const { client, opened } = clientOver(options);
  const state = { data: [] as unknown[], errors: [] as string[], started: 0, completed: 0 };
  const subscription = client.subscription(path, input, {
    onStarted: () => {
      state.started += 1;
    },
    onData: (value) => state.data.push(value),
    onError: (error) => state.errors.push(error.message),
    onComplete: () => {
      state.completed += 1;
    },
  });
  return {
    client,
    opened,
    stop: () => subscription.unsubscribe(),
    get data() {
      return state.data;
    },
    get errors() {
      return state.errors;
    },
    get started() {
      return state.started;
    },
    get completed() {
      return state.completed;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given the link that carries a live procedure", () => {
  describe("when a screen watches one", () => {
    /** @scenario "Watching a procedure opens a live channel" */
    it("opens a channel addressed to that procedure", () => {
      const live = watch("traces.onTraceUpdate");

      expect(live.opened).toHaveLength(1);
      expect(new URL(live.opened[0]!.url).pathname).toBe("/api/sse/traces.onTraceUpdate");
    });

    /** @scenario "What the screen is watching for travels with the channel" */
    it("carries what the screen asked about on the channel it opens", () => {
      const live = watch("traces.onTraceUpdate", { projectId: "project_1" });

      const asked = new URL(live.opened[0]!.url).searchParams.get("input");
      expect(asked).not.toBeNull();
      expect(JSON.parse(asked!)).toEqual({ projectId: "project_1" });
    });

    /** @scenario "Nothing mints a credential for the channel" */
    it("opens it with no credential of its own", () => {
      const live = watch();

      const opened = live.opened[0]!;
      expect(new URL(opened.url).searchParams.has("token")).toBe(false);
      expect(opened.url).not.toContain("Authorization");
      expect(opened.init).toEqual({});
    });
  });

  describe("when the connection is accepted", () => {
    /** @scenario "An update reaches the screen" */
    it("hands each update to the screen", () => {
      const live = watch();
      live.opened[0]!.accept();

      live.opened[0]!.send({ event: "span_stored", traceId: "trace_1" });

      expect(live.data).toEqual([{ event: "span_stored", traceId: "trace_1" }]);
    });

    /** @scenario "The channel's own greeting is not an update" */
    it("swallows the server's acknowledgement", () => {
      const live = watch();
      live.opened[0]!.accept();

      live.opened[0]!.send({ type: "connected" });

      expect(live.data).toEqual([]);
    });
  });

  describe("when the stream reports it has finished", () => {
    /** @scenario "A finished stream ends the watch" */
    it("ends the watch and closes the channel", () => {
      const live = watch();
      live.opened[0]!.accept();

      live.opened[0]!.send({ type: "complete" });

      expect(live.completed).toBe(1);
      expect(live.errors).toEqual([]);
      expect(live.opened[0]!.closeCount).toBeGreaterThan(0);
    });
  });

  describe("when the stream reports it could not continue", () => {
    /** @scenario "A failure of the channel itself ends the watch with an error" */
    it("tells the screen why and closes the channel", () => {
      const live = watch();
      live.opened[0]!.accept();

      live.opened[0]!.send({ type: "error", message: "permission_denied" });

      expect(live.errors).toEqual(["permission_denied"]);
      expect(live.opened[0]!.closeCount).toBeGreaterThan(0);
    });
  });

  describe("when the work being watched reports its own failure", () => {
    /**
     * The Langy turn stream's terminal entry is `{type:"error", error}`, which
     * shares its discriminant with the channel's own failure frame. Reading it
     * as the latter is what turns a named cause into a dead channel and a
     * generic unknown card.
     */
    /** @scenario "A failure the watched work reports is an update, not a dead channel" */
    it("delivers it as an update and leaves the watch open", () => {
      const live = watch("langy.onTurnStream");
      live.opened[0]!.accept();

      live.opened[0]!.send({ type: "error", error: "model_refused_the_request" });

      expect(live.data).toEqual([{ type: "error", error: "model_refused_the_request" }]);
      expect(live.errors).toEqual([]);
      expect(live.opened[0]!.closeCount).toBe(0);
    });
  });

  describe("when something arrives that cannot be read", () => {
    /** @scenario "An unreadable frame ends the watch rather than being ignored" */
    it("tells the screen the channel failed and closes it", () => {
      const live = watch();
      live.opened[0]!.accept();

      live.opened[0]!.sendRaw("this is not a frame");

      expect(live.errors).toHaveLength(1);
      expect(live.errors[0]).toContain("SSE message parsing failed");
      expect(live.opened[0]!.closeCount).toBeGreaterThan(0);
    });
  });

  describe("when the channel drops", () => {
    /** @scenario "A dropped channel is reopened after a short wait" */
    it("reopens it after a second, without alarming the screen", () => {
      const live = watch();
      live.opened[0]!.accept();

      live.opened[0]!.drop();
      vi.advanceTimersByTime(999);
      expect(live.opened).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(live.opened).toHaveLength(2);
      expect(live.errors).toEqual([]);
    });

    /** @scenario "Each further failure waits twice as long" */
    it("doubles the wait on every further failure", () => {
      const live = watch();
      const waits = [1000, 2000, 4000, 8000, 16_000];

      for (const [index, wait] of waits.entries()) {
        live.opened[index]!.drop();
        vi.advanceTimersByTime(wait - 1);
        expect(live.opened).toHaveLength(index + 1);

        vi.advanceTimersByTime(1);
        expect(live.opened).toHaveLength(index + 2);
      }
    });

    /** @scenario "A channel that never comes back gives up rather than retrying forever" */
    it("gives up once it has retried as many times as it is worth", () => {
      const live = watch();
      const waits = [1000, 2000, 4000, 8000, 16_000];

      for (const [index, wait] of waits.entries()) {
        live.opened[index]!.drop();
        vi.advanceTimersByTime(wait);
      }
      expect(live.opened).toHaveLength(6);
      expect(live.errors).toEqual([]);

      live.opened[5]!.drop();

      expect(live.errors).toEqual(["SSE connection failed after 5 attempts"]);
      vi.advanceTimersByTime(60_000);
      expect(live.opened).toHaveLength(6);
    });

    /** @scenario "A channel that comes back forgets the failures before it" */
    it("starts the wait over once a channel is accepted again", () => {
      const live = watch();

      live.opened[0]!.drop();
      vi.advanceTimersByTime(1000);
      live.opened[1]!.drop();
      vi.advanceTimersByTime(2000);
      live.opened[2]!.accept();

      live.opened[2]!.drop();
      vi.advanceTimersByTime(999);
      expect(live.opened).toHaveLength(3);

      vi.advanceTimersByTime(1);
      expect(live.opened).toHaveLength(4);
    });

    /** @scenario "A reopened channel does not read as a new subscription" */
    it("tells the screen the subscription started exactly once", () => {
      const live = watch();
      live.opened[0]!.accept();

      live.opened[0]!.drop();
      vi.advanceTimersByTime(1000);
      live.opened[1]!.accept();

      expect(live.started).toBe(1);
    });
  });

  describe("when the screen stops watching", () => {
    /** @scenario "Stopping the watch closes the channel" */
    it("closes the channel it left open", () => {
      const live = watch();
      live.opened[0]!.accept();

      live.stop();

      expect(live.opened[0]!.closeCount).toBeGreaterThan(0);
    });

    /** @scenario "Stopping the watch cancels a reopen that has not happened yet" */
    it("cancels a reopen that had been scheduled", () => {
      const live = watch();
      live.opened[0]!.accept();
      live.opened[0]!.drop();

      live.stop();

      // The pending timer itself, not only its effect: a reopen that is left
      // armed holds the whole subscription closure alive after the screen has
      // gone, and `connect` returning early hides that from every other check.
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(live.opened).toHaveLength(1);
    });
  });
});

describe("given a frame whose shape says what it is", () => {
  describe("when the frame carries the `error` discriminant", () => {
    it("reads a message as the channel's own failure and an `error` field as data", () => {
      expect(classifySseFrame({ type: "error", message: "boom" })).toBe("protocol-error");
      expect(classifySseFrame({ type: "error", error: "serialized_domain_error" })).toBe("data");
      expect(classifySseFrame({ type: "error" })).toBe("protocol-error");
    });
  });

  describe("when the frame is not a control frame at all", () => {
    it("reads it as data", () => {
      expect(classifySseFrame({ event: "span_stored" })).toBe("data");
      expect(classifySseFrame("a string")).toBe("data");
      expect(classifySseFrame(null)).toBe("data");
      expect(classifySseFrame({ type: 7 })).toBe("data");
    });
  });
});

describe("given a base address the link cannot open a channel against", () => {
  describe("when the transport is composed", () => {
    it("refuses at composition rather than at the first watch", () => {
      expect(() => sseSubscriptionLink({ url: "/api/sse", transformer: jsonFrames })).toThrow(
        "Invalid subscription base URL",
      );
    });
  });
});

describe("given a runtime with no EventSource", () => {
  describe("when a screen watches a live procedure", () => {
    /**
     * Loudly, and on the spot. A browser always has one, so reaching this is a
     * composition mistake rather than a channel failure — reporting it as the
     * latter would put "the connection failed" in front of a reader for a
     * defect no reconnect can fix.
     */
    it("says so rather than failing silently", () => {
      const client = getUntypedClient(
        createTRPCClient<AnyRouter>({
          links: [
            sseSubscriptionLink({
              url: "https://app.langwatch.test",
              transformer: jsonFrames,
            }),
          ],
        }),
      );

      expect(() => client.subscription("traces.onTraceUpdate", {}, {})).toThrow("no EventSource");
    });
  });
});

describe("given the pins the platform host set", () => {
  describe("when the link is composed with nothing said about retrying", () => {
    it("retries as many times as the message it gives up with names", () => {
      const live = watch();
      const waits = [1000, 2000, 4000, 8000, 16_000];

      for (const [index, wait] of waits.entries()) {
        live.opened[index]!.drop();
        vi.advanceTimersByTime(wait);
      }
      live.opened[5]!.drop();

      expect(live.errors[0]).toBe(
        `SSE connection failed after ${SSE_SUBSCRIPTION_MAX_RECONNECT_ATTEMPTS} attempts`,
      );
      expect(waits).toHaveLength(SSE_SUBSCRIPTION_MAX_RECONNECT_ATTEMPTS);
    });
  });
});
