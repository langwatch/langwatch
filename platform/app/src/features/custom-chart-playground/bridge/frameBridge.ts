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
 * Watchdog: the shim heartbeats every 500ms; 1500ms of silence means the
 * frame is wedged (busy loop, crash) and the bridge tears it down.
 */

import type {
  ChartFrameLogSource,
  ChartFrameParams,
  ChartFrameTheme,
  ChartQueryError,
  ChartQueryOverrides,
  ChartQueryResult,
  FrameToParentMessage,
  LwLogMessage,
} from "./bridgeProtocol";
import { CHART_FRAME_HEARTBEAT_TIMEOUT_MS } from "./bridgeProtocol";

/**
 * Runs one query for the frame. The parent supplies the SQL and maps any
 * failure to a {@link ChartQueryError} before rejecting — the bridge forwards
 * whatever it is given and never reads `error.message` itself.
 */
export type ChartFrameExecuteQuery = (
  overrides: ChartQueryOverrides,
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
  /** Called once when the watchdog kills the frame. */
  readonly onTeardown: () => void;
}

export interface FrameBridge {
  /** Pushes new page-level params into the frame (`lw:params-change`). */
  postParamsChange(params: ChartFrameParams): void;
  /** Detaches everything. Safe to call twice. */
  dispose(): void;
}

export function createFrameBridge(
  options: CreateFrameBridgeOptions,
): FrameBridge {
  const { iframe, executeQuery, onLog, onHeightChange, onTeardown } = options;

  let port: MessagePort | null = null;
  let initialized = false;
  let disposed = false;
  let lastHeartbeatAt = 0;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let activeRequestId: number | null = null;
  let activeAbort: AbortController | null = null;

  const abortActive = () => {
    activeAbort?.abort();
    activeAbort = null;
    activeRequestId = null;
  };

  const stop = () => {
    if (disposed) return;
    disposed = true;
    if (watchdog !== null) clearInterval(watchdog);
    iframe.removeEventListener("load", onFrameLoad);
    abortActive();
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

  const handleQuery = (requestId: number, overrides: ChartQueryOverrides) => {
    // One request at a time: a newer lw:query aborts the one in flight.
    abortActive();
    const abort = new AbortController();
    activeAbort = abort;
    activeRequestId = requestId;
    executeQuery(overrides, abort.signal).then(
      (result) => {
        // Stale replies (a newer request took over, or we tore down) drop.
        if (disposed || activeRequestId !== requestId || !port) return;
        port.postMessage({ type: "lw:query-result", requestId, result });
      },
      (error: unknown) => {
        if (disposed || activeRequestId !== requestId || !port) return;
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
        handleQuery(message.requestId, message.overrides ?? {});
        return;
      case "lw:set-height":
        onHeightChange(message.px);
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
      { type: "lw:init", params: options.params, theme: options.theme },
      "*",
      [channel.port2],
    );
    lastHeartbeatAt = Date.now();
    watchdog = setInterval(() => {
      if (Date.now() - lastHeartbeatAt > CHART_FRAME_HEARTBEAT_TIMEOUT_MS) {
        onLog({
          level: "error",
          source: "bridge",
          text: "No heartbeat for 1.5s — frame torn down.",
        });
        teardown();
      }
    }, CHART_FRAME_HEARTBEAT_TIMEOUT_MS / 3);
  };

  if (
    iframe.contentDocument?.readyState === "complete" &&
    iframe.contentWindow
  ) {
    onFrameLoad();
  } else {
    iframe.addEventListener("load", onFrameLoad);
  }

  return {
    postParamsChange(params: ChartFrameParams) {
      if (disposed || !port) return;
      port.postMessage({ type: "lw:params-change", params });
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
