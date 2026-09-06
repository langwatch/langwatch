/**
 * Socket side of local control: `GET /api/v1/langy/control/connect` (ADR-129
 * "Transport"). Bearer key only, no Origin check (ADR-128 precedent). Reads
 * envelopes off Redis, never the nudge; rescans pending calls on register.
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createLogger } from "@langwatch/observability";
import { WebSocket, WebSocketServer } from "ws";
import type { ConnectUpgradeRouterPort as UpgradeRouter } from "@langwatch/api";
import { PRESENCE_HEARTBEAT_MS } from "@langwatch/langy-contract";
import { DeliveredCallsService } from "../../services/langy-local-delivered-calls.service.ts";
import type { PresenceHeartbeat } from "../../ports/langy-local-presence.port.ts";
import {
  type CliFrame,
  cliFrameSchema,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type PlatformFrame,
} from "@langwatch/langy-contract";
import type {
  ControlCredential,
  ControlSession,
  LocalControlSessionCoreService,
} from "../../services/langy-local-session.service.ts";

const logger = createLogger("langwatch:langy:local-control:gateway");

export const CONTROL_CONNECT_PATH = "/api/v1/langy/control/connect";

/** Close code for a service restart: the command line reconnects at once. */
const SERVICE_RESTART_CLOSE_CODE = 1012;

/** Close code for a refused connection: the command line prints and exits. */
const POLICY_VIOLATION_CLOSE_CODE = 1008;

/** One socket, once its register frame was accepted. */
interface LiveSocket {
  socket: WebSocket;
  session: ControlSession;
  unsubscribe: (() => Promise<void>) | null;
  /** The calls this socket was handed, so none goes out twice. */
  delivered: DeliveredCallsService;
  pongs: number;
  ping: NodeJS.Timeout | null;
  heartbeat: NodeJS.Timeout | null;
  /** What the last heartbeat did, so a change is said once and not per beat. */
  presence: PresenceHeartbeat | null;
  /**
   * Set once the platform told this command line the folder is disconnected.
   * The heartbeat stops there: the record is meant to be gone, and a beat that
   * wrote it back would undo the panel's own disconnect.
   */
  released: boolean;
}

export interface ControlGatewayOptions {
  core: LocalControlSessionCoreService;
  pingIntervalMs?: number;
  pongWaitMs?: number;
  /** The biggest frame a command line may send. */
  maxPayloadBytes?: number;
}

export class LocalControlGateway {
  private readonly wss: WebSocketServer;
  private readonly core: LocalControlSessionCoreService;
  private readonly pingIntervalMs: number;
  private readonly pongWaitMs: number;
  private readonly sockets = new Set<LiveSocket>();

  constructor(options: ControlGatewayOptions) {
    this.core = options.core;
    this.pingIntervalMs = options.pingIntervalMs ?? PRESENCE_HEARTBEAT_MS;
    this.pongWaitMs = options.pongWaitMs ?? PRESENCE_HEARTBEAT_MS;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: options.maxPayloadBytes ?? 8 * 1024 * 1024,
    });
  }

  /** Mounts the upgrade path on the shared router. */
  mount(router: UpgradeRouter): void {
    router.register(CONTROL_CONNECT_PATH, (request, socket, head) =>
      this.upgrade(request, socket, head),
    );
  }

  /** How many folders this pod holds a socket for. */
  get sessionCount(): number {
    return this.sockets.size;
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      void this.accept(ws, request);
    });
  }

  /**
   * Authenticates the upgrade, then waits for the register frame. Holds the
   * first frame (sent before auth resolves) and drops later ones — an
   * unauthenticated peer must not fill process memory with frames.
   */
  private async accept(ws: WebSocket, request: IncomingMessage): Promise<void> {
    let held: WebSocket.RawData | undefined;
    const hold = (raw: WebSocket.RawData) => {
      held ??= raw;
    };
    ws.on("message", hold);

    const projectHeader = request.headers["x-project-id"];
    const authenticated = await this.core.authenticate({
      authorization: request.headers.authorization,
      projectId: Array.isArray(projectHeader) ? projectHeader[0] : projectHeader,
    });
    ws.off("message", hold);
    if (!authenticated.ok) {
      this.refuse(ws, authenticated.code, authenticated.message);
      return;
    }

    const credential = authenticated.credential;
    if (held !== undefined) {
      void this.register(ws, credential, held);
      return;
    }
    ws.once("message", (raw: WebSocket.RawData) => {
      void this.register(ws, credential, raw);
    });
  }

  /** Handles the register frame: presence, subscription, reply, pending calls. */
  private async register(
    ws: WebSocket,
    credential: ControlCredential,
    raw: WebSocket.RawData,
  ): Promise<void> {
    const frame = parseCliFrame(raw);
    if (frame?.type !== "register") {
      this.refuse(
        ws,
        "protocol_invalid",
        `The first frame must be a register frame with protocol ${LOCAL_CONTROL_PROTOCOL_VERSION}.`,
      );
      return;
    }

    const registered = await this.core.register({ credential, frame });
    if (!registered.ok) {
      this.refuse(ws, registered.code, registered.message);
      return;
    }

    const live: LiveSocket = {
      socket: ws,
      session: registered.session,
      unsubscribe: null,
      delivered: DeliveredCallsService.create(),
      pongs: 0,
      ping: null,
      heartbeat: null,
      presence: null,
      released: false,
    };
    // The command line is still running these; handing them over again would
    // run them twice on the developer's machine.
    for (const callId of registered.inFlightCallIds) live.delivered.reserve(callId);
    this.sockets.add(live);
    live.unsubscribe = await this.core.subscribe(registered.session, (platformFrame) => {
      if (platformFrame.type === "disconnect") live.released = true;
      if (!live.delivered.admit(platformFrame)) return;
      this.send(ws, platformFrame);
    });

    ws.on("message", (data) => void this.onFrame(live, data));
    ws.on("pong", () => {
      live.pongs += 1;
    });
    ws.on("close", () => void this.detach(live));
    ws.on("error", (error) => {
      logger.warn(
        { error, conversationId: live.session.conversationId },
        "local control socket error",
      );
    });
    this.startClocks(live);

    // The socket may have gone while the registration ran, with no close
    // listener on it yet. Drop it rather than leave presence refreshing for a
    // peer that is not there.
    if (ws.readyState !== WebSocket.OPEN) {
      await this.detach(live);
      return;
    }

    this.send(ws, registered.reply);

    // The turn that says "your folder is connected", and every call written
    // while this folder was away.
    await this.core.afterRegister(registered.session);
    for (const envelope of await this.core.pendingCalls(registered.session)) {
      const callFrame: PlatformFrame = {
        type: "call",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        call: envelope,
      };
      if (live.delivered.admit(callFrame)) this.send(ws, callFrame);
    }
  }

  private async onFrame(live: LiveSocket, raw: WebSocket.RawData): Promise<void> {
    const frame = parseCliFrame(raw);
    if (!frame) return;
    switch (frame.type) {
      case "ack":
        await this.core.ack(live.session, frame.callId);
        return;
      case "result":
        live.delivered.settle(frame.callId);
        await this.core.result(live.session, frame);
        return;
      case "permission_required":
        await this.core.permissionRequired(live.session, frame);
        return;
      case "permission_answered":
        await this.core.permissionAnswered(live.session, frame);
        return;
      case "deregister":
        await this.exit(live);
        live.socket.close(1000, "deregister");
        return;
      case "register":
        // A second register on an open socket is ignored; the command line
        // reconnects with a fresh socket to change what it shares.
        return;
    }
  }

  /** The heartbeat that keeps presence, and the ping that proves the peer is there. */
  private startClocks(live: LiveSocket): void {
    live.ping = setInterval(() => {
      // Each ping carries its own deadline, so a pong that lands inside the
      // wait keeps the socket even when the next ping already went out.
      const pongsBefore = live.pongs;
      live.socket.ping();
      setTimeout(() => {
        if (live.pongs !== pongsBefore) return;
        if (live.socket.readyState !== WebSocket.OPEN) return;
        logger.warn(
          { conversationId: live.session.conversationId },
          "no pong inside the wait, closing the local control socket",
        );
        live.socket.terminate();
      }, this.pongWaitMs).unref();
    }, this.pingIntervalMs);
    live.ping.unref();

    // Presence is refreshed only while the socket is open. Must not read the
    // ping's own in-flight flag: same period, same tick, so the ping would
    // always clear it first and the refresh would never run.
    live.heartbeat = setInterval(() => {
      if (live.released) return;
      if (live.socket.readyState !== WebSocket.OPEN) return;
      void this.beat(live);
    }, this.pingIntervalMs);
    live.heartbeat.unref();
  }

  /**
   * One heartbeat, and a line the first time its answer changes. "restored"
   * means this process stopped longer than the record lives.
   */
  private async beat(live: LiveSocket): Promise<void> {
    const outcome = await this.core.heartbeat(live.session);
    if (outcome === live.presence) return;
    live.presence = outcome;
    if (outcome === "restored") {
      logger.info(
        { conversationId: live.session.conversationId },
        "the folder record had lapsed while its socket stayed open, written again",
      );
    }
    if (outcome === "replaced") {
      logger.info(
        { conversationId: live.session.conversationId },
        "a newer connection holds this conversation, this socket is retired",
      );
      // Retired, not merely quiet. A socket that only stopped refreshing stayed
      // subscribed to the conversation and kept receiving the newer folder's
      // work; the call fence in the core refuses it, and this closes it.
      live.released = true;
      this.send(live.socket, {
        type: "disconnect",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        reason: "Another folder is now shared with this conversation.",
      });
      await this.detach(live);
      live.socket.close(POLICY_VIOLATION_CLOSE_CODE, "replaced");
    }
  }

  /**
   * The socket is gone, but the folder may not be — a dropped socket is a
   * network event, not a decision. Drops only what this process holds;
   * presence expires on its own via the unrefreshed heartbeat.
   */
  private async detach(live: LiveSocket): Promise<void> {
    if (!this.sockets.has(live)) return;
    this.sockets.delete(live);
    if (live.ping) clearInterval(live.ping);
    if (live.heartbeat) clearInterval(live.heartbeat);
    await live.unsubscribe?.();
  }

  /**
   * The command line said it is leaving. That IS a decision, so the folder is
   * cleared at once, its calls fail rather than run to their deadline, and the
   * disconnect is recorded.
   */
  private async exit(live: LiveSocket): Promise<void> {
    const held = this.sockets.has(live);
    await this.detach(live);
    if (!held) return;
    await this.core.retire(live.session, "cli_exit");
  }

  private refuse(ws: WebSocket, code: string, message: string): void {
    this.send(ws, {
      type: "refused",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      code,
      message,
    } as PlatformFrame);
    ws.close(POLICY_VIOLATION_CLOSE_CODE, code);
  }

  /** Writes one frame. False when the frame did not leave this process. */
  private send(ws: WebSocket, frame: PlatformFrame): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      logger.warn({ error, type: frame.type }, "local control write failed");
      return false;
    }
  }

  /**
   * Closes every socket with 1012 so the command lines reconnect at once. A
   * restart is not a disconnect: the folders stay shared and their calls stay
   * pending for the pod that picks the sockets up.
   */
  async close(): Promise<void> {
    for (const live of [...this.sockets]) {
      live.socket.close(SERVICE_RESTART_CLOSE_CODE, "service restart");
      await this.detach(live);
    }
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

function parseCliFrame(raw: WebSocket.RawData): CliFrame | null {
  try {
    const parsed = cliFrameSchema.safeParse(JSON.parse(rawToString(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function rawToString(raw: WebSocket.RawData): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return Buffer.from(raw).toString("utf8");
}
