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

/** One bridge to one frame: the handshake, the forwarded messages, the queries and the watchdog. */
export class FrameBridgeSession implements FrameBridge {
  static create(options: CreateFrameBridgeOptions): FrameBridgeSession {
    const session = new FrameBridgeSession(options);
    // The listener goes on before the frame navigates, so a fast load cannot
    // miss lw:init; a sandboxed frame's document is unreadable, so no probe.
    options.iframe.addEventListener("load", session.#onFrameLoad);
    options.iframe.src = options.src ?? CHART_FRAME_PATH;
    return session;
  }

  readonly #options: CreateFrameBridgeOptions;
  #port: MessagePort | null = null;
  #initialized = false;
  #disposed = false;
  #lastHeartbeatAt = 0;
  #watchdog: ReturnType<typeof setInterval> | null = null;
  // Keyed by requestId: several LW.query calls can be in flight at once
  // (e.g. Promise.all), and each needs its own abort lifecycle.
  readonly #activeAborts = new Map<number, AbortController>();

  private constructor(options: CreateFrameBridgeOptions) {
    this.#options = options;
  }

  postDashboardContextChange(dashboardContext: ChartFrameDashboardContext): void {
    if (this.#disposed || !this.#port) return;
    this.#port.postMessage({ type: "lw:dashboard-context-change", dashboardContext });
  }

  /** Detaches everything. Safe to call twice. */
  dispose = (): void => {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#watchdog !== null) clearInterval(this.#watchdog);
    this.#options.iframe.removeEventListener("load", this.#onFrameLoad);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    for (const abort of this.#activeAborts.values()) abort.abort();
    this.#activeAborts.clear();
    this.#port?.close();
    this.#port = null;
  };

  #teardown(): void {
    this.dispose();
    // Clearing srcdoc is what actually kills a busy-looping frame.
    this.#options.iframe.removeAttribute("srcdoc");
    this.#options.iframe.src = "about:blank";
    this.#options.onTeardown();
  }

  #onVisibilityChange = (): void => {
    // Fresh grace period: misses accrued while hidden/throttled must not read as silence.
    if (document.visibilityState === "visible")
      this.#lastHeartbeatAt = nowInstant().epochMilliseconds;
  };

  #onFrameLoad = (): void => {
    const { iframe } = this.#options;
    if (this.#disposed || this.#initialized || !iframe.contentWindow) return;
    this.#initialized = true;
    const channel = new MessageChannel();
    this.#port = channel.port1;
    this.#port.onmessage = this.#onPortMessage;
    // Sandboxed srcdoc frames have the opaque origin "null" — "*" is the only
    // targetOrigin that reaches them. Nothing sensitive rides on init.
    iframe.contentWindow.postMessage(
      {
        type: "lw:init",
        dashboardContext: this.#options.dashboardContext,
        params: this.#options.params ?? {},
        source: this.#options.source,
      },
      "*",
      [channel.port2],
    );
    this.#lastHeartbeatAt = nowInstant().epochMilliseconds;
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    this.#watchdog = setInterval(
      () => this.#checkHeartbeat(),
      CHART_FRAME_HEARTBEAT_TIMEOUT_MS / 5,
    );
  };

  /** Suspended while hidden: background throttling hits both sides, so silence proves nothing. */
  #checkHeartbeat(): void {
    if (document.visibilityState === "hidden") return;
    if (
      nowInstant().epochMilliseconds - this.#lastHeartbeatAt <=
      CHART_FRAME_HEARTBEAT_TIMEOUT_MS
    ) {
      return;
    }
    this.#options.onLog({
      level: "error",
      source: "bridge",
      text: "No heartbeat for 10s — frame torn down.",
    });
    this.#teardown();
  }

  #onPortMessage = (event: MessageEvent): void => {
    if (this.#disposed) return;
    const message = event.data as FrameToParentMessage | undefined;
    const { onHeightChange, onNavigate, onLog } = this.#options;
    switch (message?.type) {
      case "lw:heartbeat":
        this.#lastHeartbeatAt = nowInstant().epochMilliseconds;
        return;
      case "lw:query":
        this.#handleQuery(message.requestId, message.queryName, message.params ?? {});
        return;
      case "lw:set-height":
        onHeightChange(message.px);
        return;
      case "lw:navigate":
        onNavigate?.({ target: message.target, params: message.params ?? {} });
        return;
      case "lw:log":
        onLog({ level: message.level, source: message.source, text: message.parts.join(" ") });
        return;
      case "lw:error":
        onLog({ level: "error", source: message.source, text: message.message });
        return;
      default:
        return;
    }
  };

  /** Past the in-flight cap a query is refused at once rather than piled onto the executor. */
  #handleQuery(
    requestId: number,
    queryName: string,
    params: Readonly<Record<string, ChartQueryParamValue>>,
  ): void {
    if (this.#activeAborts.size >= MAX_CONCURRENT_QUERIES && this.#port) {
      this.#port.postMessage({
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
    const abort = new AbortController();
    this.#activeAborts.set(requestId, abort);
    this.#options
      .executeQuery({ queryName, params, signal: abort.signal })
      .then((result) => this.#settle(requestId, { type: "lw:query-result", requestId, result }))
      .catch((error: unknown) =>
        this.#settle(requestId, {
          type: "lw:query-error",
          requestId,
          error: toChartQueryErrorPayload(error),
        }),
      );
  }

  /** A reply for a request already forgotten (torn down, or already settled) is dropped. */
  #settle(requestId: number, reply: unknown): void {
    if (this.#disposed || !this.#activeAborts.has(requestId) || !this.#port) return;
    this.#activeAborts.delete(requestId);
    this.#port.postMessage(reply);
  }
}

/**
 * The parent's `executeQuery` rejects with a ready-made payload; anything
 * else (a bug in the mapping itself) degrades to a generic shape rather than
 * leaking a raw message across the boundary.
 */
function toChartQueryErrorPayload(error: unknown): ChartQueryError {
  if (typeof error !== "object" || error === null) return unknownChartQueryError();
  if (!("code" in error && "title" in error && "message" in error)) {
    return unknownChartQueryError();
  }
  const shaped = error as { code: unknown; title: unknown; message: unknown };
  return {
    code: String(shaped.code),
    title: String(shaped.title),
    message: String(shaped.message),
  };
}

function unknownChartQueryError(): ChartQueryError {
  return {
    code: "unknown",
    title: "Something went wrong",
    message: "The query could not be run. Check the page's log panel.",
  };
}
