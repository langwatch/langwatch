// @vitest-environment jsdom
/**
 * The bridge's session with one frame: the init handshake, the messages it forwards,
 * the query lifecycle, disposal and the heartbeat watchdog.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { FrameBridgeSession, type ChartFrameExecuteQuery } from "../frame-bridge.ts";

const CONTEXT = {
  timeWindow: { start: 0, end: 1 },
  granularitySeconds: 60,
  theme: "light" as const,
};
const RESULT = {
  columns: [],
  rows: [],
  statistics: {},
  diagnostics: [],
  followsTimeWindow: true,
  followsGranularity: false,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function attach(executeQuery: ChartFrameExecuteQuery = () => new Promise(() => undefined)) {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const inits: unknown[] = [];
  const events: unknown[] = [];
  let framePort: MessagePort | undefined;
  const fromParent: unknown[] = [];
  const bridge = FrameBridgeSession.create({
    iframe,
    source: "export default () => null;",
    executeQuery,
    dashboardContext: CONTEXT,
    onLog: (entry) => events.push({ log: entry }),
    onHeightChange: (px) => events.push({ height: px }),
    onNavigate: (args) => events.push({ navigate: args }),
    onTeardown: () => events.push("teardown"),
  });
  const frameWindow = iframe.contentWindow!;
  frameWindow.postMessage = (message: unknown, target: unknown, transfer?: Transferable[]) => {
    inits.push({ message, target });
    const port = transfer?.[0];
    if (port instanceof MessagePort) {
      framePort = port;
      framePort.onmessage = (event) => fromParent.push(event.data);
    }
  };
  const load = () => iframe.dispatchEvent(new Event("load"));
  const send = async (message: unknown) => {
    framePort!.postMessage(message);
    await flush();
    await flush();
  };
  return { iframe, bridge, inits, events, fromParent, load, send };
}

describe("the frame bridge session", () => {
  it("posts lw:init once, on the first load, with the port transferred", () => {
    const { inits, load } = attach();
    load();
    load();
    expect(inits).toEqual([
      {
        message: {
          type: "lw:init",
          dashboardContext: CONTEXT,
          params: {},
          source: "export default () => null;",
        },
        target: "*",
      },
    ]);
  });

  it("forwards height, navigation, logs and errors from the frame", async () => {
    const { events, load, send, bridge } = attach();
    load();
    await send({ type: "lw:set-height", px: 240 });
    await send({ type: "lw:navigate", target: "traces" });
    await send({ type: "lw:log", level: "warn", source: "console", parts: ["a", "b"] });
    await send({ type: "lw:error", source: "render", message: "boom" });
    await send({ type: "lw:unknown" });
    expect(events).toEqual([
      { height: 240 },
      { navigate: { target: "traces", params: {} } },
      { log: { level: "warn", source: "console", text: "a b" } },
      { log: { level: "error", source: "render", text: "boom" } },
    ]);
    bridge.dispose();
  });

  it("answers queries with results, shaped errors and a generic error", async () => {
    const answers = [
      () => Promise.resolve(RESULT),
      () => Promise.reject({ code: "bad_param", title: "Bad", message: "No" }),
      () => Promise.reject(new Error("internal")),
    ];
    const asked: string[] = [];
    const { fromParent, load, send } = attach(({ queryName }) => {
      asked.push(queryName);
      return answers.shift()!();
    });
    load();
    await send({ type: "lw:query", requestId: 1, queryName: "q1", params: { a: 1 } });
    await send({ type: "lw:query", requestId: 2, queryName: "q2" });
    await send({ type: "lw:query", requestId: 3, queryName: "q3" });
    expect(asked).toEqual(["q1", "q2", "q3"]);
    expect(fromParent).toEqual([
      { type: "lw:query-result", requestId: 1, result: RESULT },
      {
        type: "lw:query-error",
        requestId: 2,
        error: { code: "bad_param", title: "Bad", message: "No" },
      },
      {
        type: "lw:query-error",
        requestId: 3,
        error: {
          code: "unknown",
          title: "Something went wrong",
          message: "The query could not be run. Check the page's log panel.",
        },
      },
    ]);
  });

  it("refuses a query past eight in flight, and aborts the in-flight ones on dispose", async () => {
    const signals: AbortSignal[] = [];
    const { fromParent, load, send, bridge } = attach(({ signal }) => {
      signals.push(signal);
      return new Promise(() => undefined);
    });
    load();
    for (let requestId = 1; requestId <= 9; requestId++) {
      await send({ type: "lw:query", requestId, queryName: "q" });
    }
    expect(signals).toHaveLength(8);
    expect(fromParent).toEqual([
      expect.objectContaining({
        type: "lw:query-error",
        requestId: 9,
        error: expect.objectContaining({ code: "dashboard_widget_query_overloaded" }),
      }),
    ]);
    bridge.dispose();
    bridge.dispose();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("pushes dashboard context changes until disposed", async () => {
    const { fromParent, load, bridge } = attach();
    bridge.postDashboardContextChange(CONTEXT);
    load();
    bridge.postDashboardContextChange({ ...CONTEXT, theme: "dark" });
    await flush();
    bridge.dispose();
    bridge.postDashboardContextChange(CONTEXT);
    await flush();
    expect(fromParent).toEqual([
      { type: "lw:dashboard-context-change", dashboardContext: { ...CONTEXT, theme: "dark" } },
    ]);
  });

  it("tears the frame down after ten seconds without a heartbeat", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { iframe, events, load } = attach();
    load();
    vi.advanceTimersByTime(8_000);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(4_000);
    expect(events).toEqual([
      {
        log: { level: "error", source: "bridge", text: "No heartbeat for 10s — frame torn down." },
      },
      "teardown",
    ]);
    expect(iframe.src).toBe("about:blank");
    vi.advanceTimersByTime(20_000);
    expect(events).toHaveLength(2);
  });
});
