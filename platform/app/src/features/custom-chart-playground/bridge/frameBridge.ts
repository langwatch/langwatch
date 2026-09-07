/**
 * The parent side of the chart-frame bridge. Framework-free TypeScript so the
 * eventual production surface can reuse it outside React.
 *
 * Handshake: on the iframe's `load`, create a `MessageChannel`, post
 * `lw:init` with `port2` transferred — exactly once. The sandboxed frame's
 * origin is the opaque `"null"`, so the init targets `"*"` and the frame is
 * identified by holding the transferred port; nothing else is ever read off
 * the window channel.
 *
 * Watchdog: the shim heartbeats every 2s; CHART_FRAME_HEARTBEAT_TIMEOUT_MS
 * (~10s) of silence means the frame is wedged (busy loop, crash) and the
 * bridge tears it down. While the tab is hidden the watchdog is suspended —
 * background-tab timer throttling applies to both sides of the bridge, so a
 * missed beat there proves nothing — and resumes with a fresh grace period
 * on return to visible so a backlog of throttled misses never triggers an
 * instant kill.
 */

import type {
  ChartFrameLogSource,
  ChartFrameParams,
  ChartFrameTheme,
  ChartQueryError,
  ChartQueryParamValue,
  ChartQueryResult,
  FrameToParentMessage,
  LwLogMessage,
} from "./bridgeProtocol";
import { CHART_FRAME_HEARTBEAT_TIMEOUT_MS } from "./bridgeProtocol";

/**
 * Runs one of the widget's declared queries for the frame, by name, with the
 * frame's param values. The parent resolves the name to SQL, validates the
 * params against that query's declared parameters, and maps any failure to a
 * {@link ChartQueryError} before rejecting — the bridge forwards whatever it
 * is given and never reads `error.message` itself.
 */
export type ChartFrameExecuteQuery = (
  queryName: string,
  params: Readonly<Record<string, ChartQueryParamValue>>,
  signal: AbortSignal,
) => Promise<ChartQueryResult>;

export interface ChartFrameLogEntry {
  readonly level: LwLogMessage["level"];
  readonly source: ChartFrameLogSource | "bridge";
  readonly text: string;
}

export interface CreateFrameBridgeOptions {
  readonly iframe: HTMLIFrameElement;
  readonly executeQuery: ChartFrameExecuteQuery;
  readonly params: ChartFrameParams;
  readonly theme: ChartFrameTheme;
  readonly onLog: (entry: ChartFrameLogEntry) => void;
  readonly onHeightChange: (px: number) => void;
  /**
   * `LW.navigate(target, params)` from the frame. Forwarded as-is —
   * allowlist checking and route resolution happen in the caller (see
   * `usePlaygroundChartNavigate`), not here. Omitted entirely, a navigate
   * message is silently dropped (a no-op is the correct behavior when a
   * widget host has no router to navigate with).
   */
  readonly onNavigate?: (
    target: string,
    params: Readonly<Record<string, unknown>>,
  ) => void;
  /** Called once when the watchdog kills the frame. */
  readonly onTeardown: () => void;
}

export interface FrameBridge {
  /** Pushes new page-level params into the frame (`lw:params-change`). */
  postParamsChange(params: ChartFrameParams): void;
  /** Detaches everything. Safe to call twice. */
  dispose(): void;
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

/**
 * Owns the whole bridge lifecycle for one iframe. Split into methods (rather
 * than the single large closure this used to be) purely to keep each unit of
 * behavior — the handshake, the watchdog, per-query abort tracking, message
 * dispatch — readable and independently sized; the mutable state below is
 * still exactly one bridge's worth, never shared across instances.
 */
class FrameBridgeController implements FrameBridge {
  private readonly options: CreateFrameBridgeOptions;
  private port: MessagePort | null = null;
  private initialized = false;
  private disposed = false;
  private lastHeartbeatAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  // Keyed by requestId, not a single slot: a widget can have several
  // LW.query calls in flight at once (e.g. Promise.all of two queries), and
  // each needs its own abort lifecycle independent of the others.
  private readonly activeAborts = new Map<number, AbortController>();

  constructor(options: CreateFrameBridgeOptions) {
    this.options = options;
    const { iframe } = options;
    if (
      iframe.contentDocument?.readyState === "complete" &&
      iframe.contentWindow
    ) {
      this.onFrameLoad();
    } else {
      iframe.addEventListener("load", this.onFrameLoad);
    }
  }

  postParamsChange(params: ChartFrameParams): void {
    if (this.disposed || !this.port) return;
    this.port.postMessage({ type: "lw:params-change", params });
  }

  dispose = (): void => {
    this.stop();
  };

  private abortAll(): void {
    for (const abort of this.activeAborts.values()) abort.abort();
    this.activeAborts.clear();
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      // Fresh grace period: a backlog of misses accrued while hidden/
      // throttled must not read as instant silence.
      this.lastHeartbeatAt = Date.now();
    }
  };

  private stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.options.iframe.removeEventListener("load", this.onFrameLoad);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.abortAll();
    this.port?.close();
    this.port = null;
  }

  private teardown(): void {
    this.stop();
    // Clearing srcdoc is what actually kills a busy-looping frame.
    this.options.iframe.removeAttribute("srcdoc");
    this.options.iframe.src = "about:blank";
    this.options.onTeardown();
  }

  private handleQuery(
    requestId: number,
    queryName: string,
    params: Readonly<Record<string, ChartQueryParamValue>>,
  ): void {
    // Each request gets its own abort controller, so concurrent queries
    // (e.g. Promise.all of two LW.query calls) don't cancel one another.
    const abort = new AbortController();
    this.activeAborts.set(requestId, abort);
    this.options.executeQuery(queryName, params, abort.signal).then(
      (result) => {
        // A reply for a request we've already forgotten (torn down, or this
        // exact requestId already settled) is dropped.
        if (this.disposed || !this.activeAborts.has(requestId) || !this.port)
          return;
        this.activeAborts.delete(requestId);
        this.port.postMessage({ type: "lw:query-result", requestId, result });
      },
      (error: unknown) => {
        if (this.disposed || !this.activeAborts.has(requestId) || !this.port)
          return;
        this.activeAborts.delete(requestId);
        this.port.postMessage({
          type: "lw:query-error",
          requestId,
          error: toChartQueryErrorPayload(error),
        });
      },
    );
  }

  private readonly onPortMessage = (event: MessageEvent): void => {
    if (this.disposed) return;
    const message = event.data as FrameToParentMessage | undefined;
    const { onHeightChange, onNavigate, onLog } = this.options;
    switch (message?.type) {
      case "lw:heartbeat":
        this.lastHeartbeatAt = Date.now();
        return;
      case "lw:query":
        this.handleQuery(
          message.requestId,
          message.queryName,
          message.params ?? {},
        );
        return;
      case "lw:set-height":
        onHeightChange(message.px);
        return;
      case "lw:navigate":
        onNavigate?.(message.target, message.params ?? {});
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

  private readonly onFrameLoad = (): void => {
    const { iframe, onLog } = this.options;
    if (this.disposed || this.initialized || !iframe.contentWindow) return;
    this.initialized = true;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = this.onPortMessage;
    // Sandboxed srcdoc frames have the opaque origin "null" — "*" is the only
    // targetOrigin that reaches them. Nothing sensitive rides on init.
    iframe.contentWindow.postMessage(
      {
        type: "lw:init",
        params: this.options.params,
        theme: this.options.theme,
      },
      "*",
      [channel.port2],
    );
    this.lastHeartbeatAt = Date.now();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.watchdog = setInterval(() => {
      // Suspended while hidden: background-tab timer throttling hits both
      // sides of the bridge, so silence here is not evidence of a wedged
      // frame. onVisibilityChange resets lastHeartbeatAt on return, giving a
      // fresh window before the check below can fire again.
      if (document.visibilityState === "hidden") return;
      if (
        Date.now() - this.lastHeartbeatAt >
        CHART_FRAME_HEARTBEAT_TIMEOUT_MS
      ) {
        onLog({
          level: "error",
          source: "bridge",
          text: "No heartbeat for 10s — frame torn down.",
        });
        this.teardown();
      }
    }, CHART_FRAME_HEARTBEAT_TIMEOUT_MS / 5);
  };
}

export function createFrameBridge(
  options: CreateFrameBridgeOptions,
): FrameBridge {
  return new FrameBridgeController(options);
}
