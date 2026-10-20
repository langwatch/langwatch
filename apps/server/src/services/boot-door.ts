import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  escapeHtml,
  HEARTBEAT_INTERVAL_MS,
  renderConsolePage,
  startHeartbeat,
  startLivenessThread,
} from "@langwatch/process/liveness-thread";

import type { RuntimeEvent } from "../shared/runtime-contract.ts";
import { ASSET_PREFIX, readEntryAssets, serveHashedAsset } from "./boot-assets.ts";

/** The boot page's event stream; every other path answers the page or a plain 503. */
export const BOOT_EVENTS_PATH = "/_langwatch/boot/events";
const BOOT_RETRY_AFTER_SECONDS = 5;
const CLOSE_GRACE_MS = 500;

/** The public port while LangWatch starts: the boot page first, then the app itself. */
export type BootDoor = Readonly<{
  port: number;
  /** Shows a service's progress on every open boot page. */
  feed: (event: RuntimeEvent) => void;
  /** The backend answered: forward the public port to it and reload every boot page. */
  openApp: () => Promise<void>;
  /**
   * The app is unpacked: its hashed assets are served from `clientDir` until the swap, and every
   * boot page fetches the entry scripts and styles, so the app paints the moment it loads.
   */
  offerAssets: (app: { clientDir: string }) => void;
  /** The first boot failed: every boot page says why and where the logs are. */
  fail: (failure: { reason: string; logsDir: string }) => void;
  close: () => Promise<void>;
}>;

type Phase =
  | { name: "starting" }
  | { name: "ready" }
  | { name: "failed"; reason: string; logsDir: string };

const STATE_OF: Partial<Record<RuntimeEvent["type"], string>> = {
  starting: "starting",
  healthy: "ready",
  restarting: "restarting",
  crashed: "failed",
  stopped: "stopped",
};

/** What the board knows: each service's state, the open streams, the phase, the app's assets. */
type BoardState = {
  states: Map<string, string>;
  streams: Set<http.ServerResponse>;
  phase: Phase;
  entries: string[];
};

function sendEvent({
  res,
  event,
  data,
}: {
  res: http.ServerResponse;
  event?: string;
  data: unknown;
}): void {
  const head = event === undefined ? "" : `event: ${event}\n`;
  res.write(`${head}data: ${JSON.stringify(data)}\n\n`);
}

function sendPhase({ res, phase }: { res: http.ServerResponse; phase: Phase }): void {
  if (phase.name === "ready") sendEvent({ res, event: "ready", data: {} });
  if (phase.name === "failed") sendEvent({ res, event: "failed", data: phase });
}

/** A new boot page catches up on everything so far, then hears what follows. */
function attachStream({ board, res }: { board: BoardState; res: http.ServerResponse }): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  // An SSE comment, so the stream opens through the door's proxy before any event.
  res.write(": open\n\n");
  for (const [service, state] of board.states) sendEvent({ res, data: { service, state } });
  if (board.entries.length > 0) sendEvent({ res, event: "assets", data: board.entries });
  sendPhase({ res, phase: board.phase });
  board.streams.add(res);
  res.on("close", () => board.streams.delete(res));
}

function feedBoard({ board, event }: { board: BoardState; event: RuntimeEvent }): void {
  const state = STATE_OF[event.type];
  if (state === undefined || board.states.get(event.service) === state) return;
  board.states.set(event.service, state);
  for (const res of board.streams) sendEvent({ res, data: { service: event.service, state } });
}

function settlePhase({ board, phase }: { board: BoardState; phase: Phase }): void {
  board.phase = phase;
  for (const res of board.streams) sendPhase({ res, phase });
}

/** What every open boot page is told: each service's state, then ready or failed. */
function bootBoard() {
  const board: BoardState = {
    states: new Map(),
    streams: new Set(),
    phase: { name: "starting" },
    entries: [],
  };
  const endAll = () => {
    for (const res of board.streams) res.end();
  };
  return {
    attach: (res: http.ServerResponse) => attachStream({ board, res }),
    feed: (event: RuntimeEvent) => feedBoard({ board, event }),
    ready: () => {
      settlePhase({ board, phase: { name: "ready" } });
      endAll();
    },
    fail: ({ reason, logsDir }: { reason: string; logsDir: string }) => {
      if (board.phase.name !== "starting") return;
      settlePhase({ board, phase: { name: "failed", reason, logsDir } });
    },
    assets: (offered: string[]) => {
      board.entries = offered;
      for (const res of board.streams) sendEvent({ res, event: "assets", data: offered });
    },
    endAll,
  };
}

type BootBoard = ReturnType<typeof bootBoard>;

/** The loopback page server: the event stream, the page to a browser, a plain 503 to the rest. */
function answerBootRequest({
  req,
  res,
  board,
  clientDir,
}: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  board: BootBoard;
  clientDir: string | null;
}): void {
  if (req.url === BOOT_EVENTS_PATH) {
    board.attach(res);
    return;
  }
  req.resume();
  const pathname = String(req.url).split("?")[0] ?? "";
  const isAsset = clientDir !== null && pathname.startsWith(ASSET_PREFIX);
  if (isAsset && serveHashedAsset({ clientDir, pathname, res })) return;
  if (!String(req.headers.accept ?? "").includes("text/html")) {
    res
      .writeHead(503, {
        "Content-Type": "text/plain",
        "Retry-After": String(BOOT_RETRY_AFTER_SECONDS),
        "Cache-Control": "no-store",
      })
      .end("LangWatch is starting");
    return;
  }
  res
    .writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    })
    .end(renderBootPage());
}

/**
 * Holds `port` with the api's own liveness door (packages/process), forwarding to a loopback
 * boot page until the backend at `backendPort` is healthy. Spec: 09-prebuilt-app.feature.
 */
export async function openBootDoor({
  port,
  backendPort,
  report,
}: {
  port: number;
  backendPort: number;
  /** Where the door's own complaints go. */
  report: (line: string) => void;
}): Promise<BootDoor> {
  const board = bootBoard();
  let clientDir: string | null = null;
  const page = http.createServer((req, res) => answerBootRequest({ req, res, board, clientDir }));
  await new Promise<void>((resolve) => page.listen(0, "127.0.0.1", resolve));
  const heartbeat = startHeartbeat({ intervalMs: HEARTBEAT_INTERVAL_MS });
  const door = await startLivenessThread({
    port,
    heartbeat: heartbeat.buffer,
    proxyPort: (page.address() as AddressInfo).port,
    logger: {
      info: () => undefined,
      error: (_fields, message) => report(`boot page: ${message}`),
    },
  }).catch((error: unknown) => {
    heartbeat.stop();
    page.close();
    throw error;
  });

  return {
    port: door.address.port,
    feed: board.feed,
    openApp: async () => {
      await door.proxyTo({ port: backendPort });
      board.ready();
    },
    offerAssets: (app) => {
      clientDir = app.clientDir;
      board.assets(readEntryAssets(app));
    },
    fail: board.fail,
    close: async () => {
      board.endAll();
      await door.close({ graceMs: CLOSE_GRACE_MS });
      heartbeat.stop();
      page.closeAllConnections();
      await new Promise<void>((resolve) => page.close(() => resolve()));
    },
  };
}

/** The page: each service's state from the event stream; it reloads into the app once ready. */
function renderBootPage(): string {
  const script = `
const list = document.getElementById("services");
const status = document.getElementById("status");
const rows = {};
const events = new EventSource(${JSON.stringify(BOOT_EVENTS_PATH)});
events.onmessage = (message) => {
  const { service, state } = JSON.parse(message.data);
  let row = rows[service];
  if (!row) {
    row = document.createElement("li");
    rows[service] = row;
    list.appendChild(row);
  }
  row.textContent = service + ": " + state;
};
events.addEventListener("assets", (message) => {
  for (const href of JSON.parse(message.data)) {
    const link = document.createElement("link");
    link.rel = href.endsWith(".css") ? "preload" : "modulepreload";
    if (href.endsWith(".css")) link.as = "style";
    link.crossOrigin = "";
    link.href = href;
    document.head.appendChild(link);
  }
});
events.addEventListener("ready", () => {
  events.close();
  location.reload();
});
events.addEventListener("failed", (message) => {
  events.close();
  const failure = JSON.parse(message.data);
  status.textContent = "LangWatch failed to start: " + failure.reason + ". The logs are in " + failure.logsDir + ".";
});`;
  return renderConsolePage({
    title: "Starting LangWatch",
    body: [
      "<h1>Starting LangWatch</h1>",
      `<p id="status">${escapeHtml("Getting everything ready. This page opens LangWatch by itself.")}</p>`,
      '<ul id="services"></ul>',
      `<script>${script}</script>`,
    ],
  });
}
