/**
 * The parent side of the chart-frame bridge. Framework-free TypeScript so the
 * eventual production surface can reuse it outside React.
 *
 * Navigation: the bridge owns iframe navigation. The load listener is
 * registered before the src is assigned, so a fast frame load cannot miss
 * the lw:init delivery.
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
  ChartFrameDashboardContext,
  ChartFrameLogSource,
  ChartFrameParamsSnapshot,
  ChartQueryError,
  ChartQueryParamValue,
  ChartQueryResult,
  FrameToParentMessage,
  LwLogMessage,
  LwRenderReceiptMessage,
} from "./bridgeProtocol";
import {
  CHART_FRAME_HEARTBEAT_TIMEOUT_MS,
  CHART_FRAME_PATH,
  CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS,
} from "./bridgeProtocol";

/** Upper bound on simultaneously in-flight `lw:query` requests per frame. */
const MAX_CONCURRENT_QUERIES = 8;

/** Upper bound on the receipt's `errorText`, mirroring the markup cap. */
const RENDER_RECEIPT_MAX_ERROR_TEXT_CHARS = 4_000;

/**
 * How often the parent delivers a render receipt to `onRenderReceipt`, at
 * most. The shim itself debounces before posting, but `lw:render-receipt`
 * arrives over a port the sandboxed frame's author code can also post on
 * directly, bypassing the shim entirely — this throttle is the parent's own
 * backstop, independent of whatever the frame side does or doesn't enforce.
 */
const RENDER_RECEIPT_THROTTLE_MS = 100;

/**
 * Runs one of the widget's declared queries for the frame, by name, with the
 * frame's param values. The parent resolves the name to SQL, validates the
 * params against that query's declared parameters, and maps any failure to a
 * {@link ChartQueryError} before rejecting — the bridge forwards whatever it
 * is given and never reads `error.message` itself.
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

/**
 * A render receipt as the parent receives it — the wire message without its
 * `type` discriminator, which the transport has already used.
 */
export type ChartFrameRenderReceipt = Omit<LwRenderReceiptMessage, "type">;

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
  /**
   * The frame document URL. Defaults to CHART_FRAME_PATH. The bridge assigns
   * this after registering the load listener, ensuring the listener is in
   * place before the frame navigates.
   */
  readonly src?: string;
  readonly onLog: (entry: ChartFrameLogEntry) => void;
  readonly onHeightChange: (px: number) => void;
  /**
   * `LW.navigate(target, params)` from the frame. Forwarded as-is —
   * allowlist checking and route resolution happen in the caller (see
   * `useDashboardWidgetChartNavigate`), not here. Omitted entirely, a navigate
   * message is silently dropped (a no-op is the correct behavior when a
   * widget host has no router to navigate with).
   */
  readonly onNavigate?: (args: {
    target: string;
    params: Readonly<Record<string, unknown>>;
  }) => void;
  /**
   * The frame's render receipt (`lw:render-receipt`) — status, error text and
   * the rendered `#lw-root` markup — arriving on mount and on every subsequent
   * DOM change. The host keeps the latest per widget so an off-screen agent
   * can read what the widget painted. Omitted, receipts are dropped.
   */
  readonly onRenderReceipt?: (receipt: ChartFrameRenderReceipt) => void;
  /** Called once when the watchdog kills the frame. */
  readonly onTeardown: () => void;
}

export interface FrameBridge {
  /** Pushes new dashboard context into the frame (`lw:dashboard-context-change`). */
  postDashboardContextChange(
    dashboardContext: ChartFrameDashboardContext,
  ): void;
  /** Detaches everything. Safe to call twice. */
  dispose(): void;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one factory wiring the iframe's postMessage handlers and lifecycle together; splitting it would scatter closured state.
export function createFrameBridge(
  options: CreateFrameBridgeOptions,
): FrameBridge {
  const {
    iframe,
    executeQuery,
    onLog,
    onHeightChange,
    onNavigate,
    onRenderReceipt,
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

  // Receive-side throttle for render receipts, independent of the shim's own
  // debounce (see RENDER_RECEIPT_THROTTLE_MS). Trailing: every receipt in a
  // window overwrites `pendingReceipt`, and only the last one seen when the
  // window elapses is delivered — a burst of synchronous posts collapses to
  // one `onRenderReceipt` call.
  let pendingReceipt: ChartFrameRenderReceipt | null = null;
  let receiptTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReceipt = (receipt: ChartFrameRenderReceipt) => {
    pendingReceipt = receipt;
    if (receiptTimer !== null) return;
    receiptTimer = setTimeout(() => {
      receiptTimer = null;
      if (pendingReceipt) {
        const next = pendingReceipt;
        pendingReceipt = null;
        onRenderReceipt?.(next);
      }
    }, RENDER_RECEIPT_THROTTLE_MS);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      // Fresh grace period: a backlog of misses accrued while hidden/
      // throttled must not read as instant silence.
      lastHeartbeatAt = Date.now();
    }
  };

  const stop = () => {
    if (disposed) return;
    disposed = true;
    if (watchdog !== null) clearInterval(watchdog);
    if (receiptTimer !== null) clearTimeout(receiptTimer);
    receiptTimer = null;
    pendingReceipt = null;
    iframe.removeEventListener("load", onFrameLoad);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    abortAll();
    port?.close();
    port = null;
  };

  const teardown = () => {
    stop();
    // Pointing the frame at about:blank is what actually kills a busy-looping
    // frame — it discards the loaded document (and its author code) entirely.
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
        lastHeartbeatAt = Date.now();
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
      case "lw:render-receipt": {
        // event.data is untrusted: author code can post on the transferred
        // port directly, bypassing the shim that normally enforces the
        // markup cap. sanitizeRenderReceipt re-validates and re-clamps
        // every field; a malformed message is dropped outright.
        const receipt = sanitizeRenderReceipt(message);
        if (receipt) scheduleReceipt(receipt);
        return;
      }
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
    // The sandboxed frame has the opaque origin "null" — "*" is the only
    // targetOrigin that reaches it. Nothing sensitive rides on init; the
    // widget source is author code the frame will run anyway.
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
    lastHeartbeatAt = Date.now();
    document.addEventListener("visibilitychange", onVisibilityChange);
    watchdog = setInterval(() => {
      // Suspended while hidden: background-tab timer throttling hits both
      // sides of the bridge, so silence here is not evidence of a wedged
      // frame. onVisibilityChange resets lastHeartbeatAt on return, giving a
      // fresh window before the check below can fire again.
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastHeartbeatAt > CHART_FRAME_HEARTBEAT_TIMEOUT_MS) {
        onLog({
          level: "error",
          source: "bridge",
          text: "No heartbeat for 10s — frame torn down.",
        });
        teardown();
      }
    }, CHART_FRAME_HEARTBEAT_TIMEOUT_MS / 5);
  };

  // Register the load listener before assigning src, so a fast frame load
  // cannot miss the lw:init delivery.
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

/** A finite, non-negative height; anything else is not a real measurement. */
function sanitizeReceiptHeight(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * Validates and clamps an `lw:render-receipt` payload from the wire. The
 * frame is sandboxed but author code can post on the transferred port
 * directly, skipping the shim that normally enforces the markup cap — so the
 * parent re-checks every field itself rather than trusting the shape.
 * Returns `null` for non-object values, unsupported statuses, or non-string
 * `markup`. Normalizes invalid heights to `0` and omits non-string `errorText`.
 */
export function sanitizeRenderReceipt(
  raw: unknown,
): ChartFrameRenderReceipt | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;

  if (candidate.status !== "ok" && candidate.status !== "error") return null;
  if (typeof candidate.markup !== "string") return null;

  const isMarkupOverCap =
    candidate.markup.length > CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS;
  const markup = isMarkupOverCap
    ? candidate.markup.slice(0, CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS)
    : candidate.markup;
  const isMarkupTruncated =
    isMarkupOverCap || candidate.isMarkupTruncated === true;

  const errorText =
    typeof candidate.errorText === "string"
      ? candidate.errorText.slice(0, RENDER_RECEIPT_MAX_ERROR_TEXT_CHARS)
      : undefined;

  return {
    status: candidate.status,
    markup,
    isMarkupTruncated,
    height: sanitizeReceiptHeight(candidate.height),
    ...(errorText !== undefined ? { errorText } : {}),
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
