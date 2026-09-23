/**
 * The parent side of the chart-frame bridge. Framework-free TypeScript so the eventual
 * production surface can reuse it outside React.
 */

/**
 * Handshake: on `load`, create a `MessageChannel` and post `lw:init` with `port2` transferred,
 * exactly once. The frame's origin is opaque `"null"`, so init targets `"*"` — holding the
 * transferred port is what identifies the frame, nothing else read off the window channel.
 */

/**
 * Watchdog: heartbeats every 2s; CHART_FRAME_HEARTBEAT_TIMEOUT_MS (~10s) of silence means the
 * frame is wedged. Suspended while the tab is hidden, since background-tab throttling hits both
 * sides equally, and resumes with a fresh grace period so throttled misses never trigger a kill.
 */

import type {
  ChartFrameDashboardContext,
  ChartFrameLogSource,
  ChartFrameParamsSnapshot,
  ChartQueryError,
  ChartQueryParamValue,
  ChartQueryResult,
  FrameToParentMessage,
  LwLogMessage,
} from "@langwatch/analytics-contract/chart-frame-protocol";
import {
  CHART_FRAME_HEARTBEAT_TIMEOUT_MS,
  CHART_FRAME_PATH,
} from "@langwatch/analytics-contract/chart-frame-protocol";
import { nowInstant } from "@langwatch/time";

/** Upper bound on simultaneously in-flight `lw:query` requests per frame. */
const MAX_CONCURRENT_QUERIES = 8;

/**
 * Runs one declared query for the frame, by name, with its param values.
 * The parent resolves the name to SQL, validates params, and maps any
 * failure to a {@link ChartQueryError} — forwarded as-is, never read here.
 */
export type ChartFrameExecuteQuery = (args: {
  queryName: string;
  params: Readonly<Record<string, ChartQueryParamValue>>;
  signal: AbortSignal;
}) => Promise<ChartQueryResult>;

export interface ChartFrameLogEntry {
  readonly level: LwLogMessage["level"];
  readonly source: ChartFrameLogSource | "bridge";
  readonly text: string;
}

export interface CreateFrameBridgeOptions {
  readonly iframe: HTMLIFrameElement;
  readonly executeQuery: ChartFrameExecuteQuery;
  readonly dashboardContext: ChartFrameDashboardContext;
  /** Author-declared parameter defaults, delivered once on `lw:init`. */
  readonly params?: ChartFrameParamsSnapshot;
  /**
   * The widget's React/TSX source, delivered once on `lw:init`. The frame
   * document carries no author code, so this is how each frame receives its
   * own widget.
   */
  readonly source: string;
  /** The frame document URL, CHART_FRAME_PATH unless given; the bridge navigates to it. */
  readonly src?: string;
  readonly onLog: (entry: ChartFrameLogEntry) => void;
  readonly onHeightChange: (px: number) => void;
  /**
   * `LW.navigate(target, params)` from the frame, forwarded as-is —
   * allowlist checking and route resolution happen in the caller (see
   * `useDashboardWidgetChartNavigate`). Omitted, navigate messages no-op.
   */
  readonly onNavigate?: (args: {
    target: string;
    params: Readonly<Record<string, unknown>>;
  }) => void;
  /** Called once when the watchdog kills the frame. */
  readonly onTeardown: () => void;
}

export interface FrameBridge {
  /** Pushes new dashboard context into the frame (`lw:dashboard-context-change`). */
  postDashboardContextChange(dashboardContext: ChartFrameDashboardContext): void;
  /** Detaches everything. Safe to call twice. */
  dispose(): void;
}

// One factory wiring the iframe's postMessage handlers and lifecycle together;
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: splitting scatters state.
export function createFrameBridge(options: CreateFrameBridgeOptions): FrameBridge {
  const {
    iframe,
    executeQuery,
    onLog,
    onHeightChange,
    onNavigate,
    onTeardown,
    src = CHART_FRAME_PATH,
  } = options;

  let port: MessagePort | null = null;
  let initialized = false;
  let disposed = false;
  let lastHeartbeatAt = 0;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  // Keyed by requestId, not a single slot: a widget can have several
  // LW.query calls in flight at once (e.g. Promise.all of two queries), and
  // each needs its own abort lifecycle independent of the others.
  const activeAborts = new Map<number, AbortController>();

  const abortAll = () => {
    for (const abort of activeAborts.values()) abort.abort();
    activeAborts.clear();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      // Fresh grace period: a backlog of misses accrued while hidden/
      // throttled must not read as instant silence.
      lastHeartbeatAt = nowInstant().epochMilliseconds;
    }
  };

  const stop = () => {
    if (disposed) return;
    disposed = true;
    if (watchdog !== null) clearInterval(watchdog);
    iframe.removeEventListener("load", onFrameLoad);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    abortAll();
    port?.close();
    port = null;
  };

  const teardown = () => {
    stop();
    // Clearing srcdoc is what actually kills a busy-looping frame.
    iframe.removeAttribute("srcdoc");
    iframe.src = "about:blank";
    onTeardown();
  };

  const handleQuery = (
    requestId: number,
    queryName: string,
    params: Readonly<Record<string, ChartQueryParamValue>>,
  ) => {
    // Bound in-flight queries: author code can fire an unbounded fan-out
    // (a render loop calling LW.query, a large Promise.all), and each one is
    // a real backend request. Past the cap, reject immediately rather than
    // pile onto the executor. Settled requests are dropped from activeAborts
    // below, so the slot frees as soon as one resolves.
    if (activeAborts.size >= MAX_CONCURRENT_QUERIES && port) {
      port.postMessage({
        type: "lw:query-error",
        requestId,
        error: {
          code: "dashboard_widget_query_overloaded",
          title: "Too many queries at once",
          message: `A widget may run at most ${MAX_CONCURRENT_QUERIES} queries at a time. This one was not started.`,
        },
      });
      return;
    }
    // Each request gets its own abort controller, so concurrent queries
    // (e.g. Promise.all of two LW.query calls) don't cancel one another.
    const abort = new AbortController();
    activeAborts.set(requestId, abort);
    executeQuery({ queryName, params, signal: abort.signal }).then(
      (result) => {
        // A reply for a request we've already forgotten (torn down, or this
        // exact requestId already settled) is dropped.
        if (disposed || !activeAborts.has(requestId) || !port) return;
        activeAborts.delete(requestId);
        port.postMessage({ type: "lw:query-result", requestId, result });
      },
      (error: unknown) => {
        if (disposed || !activeAborts.has(requestId) || !port) return;
        activeAborts.delete(requestId);
        port.postMessage({
          type: "lw:query-error",
          requestId,
          error: toChartQueryErrorPayload(error),
        });
      },
    );
  };

  const onPortMessage = (event: MessageEvent) => {
    if (disposed) return;
    const message = event.data as FrameToParentMessage | undefined;
    switch (message?.type) {
      case "lw:heartbeat":
        lastHeartbeatAt = nowInstant().epochMilliseconds;
        return;
      case "lw:query":
        handleQuery(message.requestId, message.queryName, message.params ?? {});
        return;
      case "lw:set-height":
        onHeightChange(message.px);
        return;
      case "lw:navigate":
        onNavigate?.({ target: message.target, params: message.params ?? {} });
        return;
      case "lw:log":
        onLog({
          level: message.level,
          source: message.source,
          text: message.parts.join(" "),
        });
        return;
      case "lw:error":
        onLog({
          level: "error",
          source: message.source,
          text: message.message,
        });
        return;
      default:
        return;
    }
  };

  const onFrameLoad = () => {
    if (disposed || initialized || !iframe.contentWindow) return;
    initialized = true;
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = onPortMessage;
    // Sandboxed srcdoc frames have the opaque origin "null" — "*" is the only
    // targetOrigin that reaches them. Nothing sensitive rides on init.
    iframe.contentWindow.postMessage(
      {
        type: "lw:init",
        dashboardContext: options.dashboardContext,
        params: options.params ?? {},
        source: options.source,
      },
      "*",
      [channel.port2],
    );
    lastHeartbeatAt = nowInstant().epochMilliseconds;
    document.addEventListener("visibilitychange", onVisibilityChange);
    watchdog = setInterval(() => {
      // Suspended while hidden: background-tab timer throttling hits both
      // sides of the bridge, so silence here is not evidence of a wedged
      // frame. onVisibilityChange resets lastHeartbeatAt on return, giving a
      // fresh window before the check below can fire again.
      if (document.visibilityState === "hidden") return;
      if (nowInstant().epochMilliseconds - lastHeartbeatAt > CHART_FRAME_HEARTBEAT_TIMEOUT_MS) {
        onLog({
          level: "error",
          source: "bridge",
          text: "No heartbeat for 10s — frame torn down.",
        });
        teardown();
      }
    }, CHART_FRAME_HEARTBEAT_TIMEOUT_MS / 5);
  };

  // The listener goes on before the frame navigates, so a fast load cannot
  // miss lw:init; a sandboxed frame's document is unreadable, so no probe.
  iframe.addEventListener("load", onFrameLoad);
  iframe.src = src;

  return {
    postDashboardContextChange(dashboardContext: ChartFrameDashboardContext) {
      if (disposed || !port) return;
      port.postMessage({
        type: "lw:dashboard-context-change",
        dashboardContext,
      });
    },
    dispose: stop,
  };
}

/**
 * The parent's `executeQuery` rejects with a ready-made payload; anything
 * else (a bug in the mapping itself) degrades to a generic shape rather than
 * leaking a raw message across the boundary.
 */
function toChartQueryErrorPayload(error: unknown): ChartQueryError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "title" in error &&
    "message" in error
  ) {
    const shaped = error as { code: unknown; title: unknown; message: unknown };
    return {
      code: String(shaped.code),
      title: String(shaped.title),
      message: String(shaped.message),
    };
  }
  return {
    code: "unknown",
    title: "Something went wrong",
    message: "The query could not be run. Check the page's log panel.",
  };
}
