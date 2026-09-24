/**
 * Socket side of local control, `GET /api/v1/langy/control/connect` (ADR-129 "Transport"), moved
 * unchanged from main's control.gateway.ts. Bearer key only, no Origin check (ADR-128 precedent).
 * Reads envelopes off Redis, never the nudge; rescans pending calls on register.
 */

import type { ProtocolConnection } from "@langwatch/api";
import {
  PRESENCE_HEARTBEAT_MS,
  type CliFrame,
  cliFrameSchema,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type LocalControlConnectCredentials,
  type LocalControlRefusedCode,
  type PlatformFrame,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type { PresenceHeartbeat } from "../repositories/langy-local-presence.repository.ts";
import type {
  ControlCredential,
  ControlSession,
} from "../rules/langy-local-session-contract.rules.ts";
import { DeliveredCallsService } from "./langy-local-delivered-calls.service.ts";
import type { LocalControlSessionCoreService } from "./langy-local-session.service.ts";

const logger = createLogger("langwatch:langy:local-control:gateway");

/** Close code for a service restart: the command line reconnects at once. */
const SERVICE_RESTART_CLOSE_CODE = 1012;

/** Close code for a refused connection: the command line prints and exits. */
const POLICY_VIOLATION_CLOSE_CODE = 1008;

/** One socket, once its register frame was accepted. */
interface LiveSocket {
  socket: ProtocolConnection;
  session: ControlSession;
  unsubscribe: (() => Promise<void>) | null;
  /** The calls this socket was handed, so none goes out twice. */
  delivered: DeliveredCallsService;
  pongs: number;
  ping: NodeJS.Timeout | null;
  heartbeat: NodeJS.Timeout | null;
  /** What the last heartbeat did, so a change is said once and not per beat. */
  presence: PresenceHeartbeat | null;
  /** Set once the folder is told it is disconnected; a later beat would undo that. */
  released: boolean;
}

export interface LocalControlConnectionOptions {
  core: LocalControlSessionCoreService;
  pingIntervalMs?: number;
  pongWaitMs?: number;
}

export class LocalControlConnectionService {
  private readonly core: LocalControlSessionCoreService;
  private readonly pingIntervalMs: number;
  private readonly pongWaitMs: number;
  private readonly sockets = new Set<LiveSocket>();

  static create(options: LocalControlConnectionOptions): LocalControlConnectionService {
    return new LocalControlConnectionService(options);
  }

  private constructor(options: LocalControlConnectionOptions) {
    this.core = options.core;
    this.pingIntervalMs = options.pingIntervalMs ?? PRESENCE_HEARTBEAT_MS;
    this.pongWaitMs = options.pongWaitMs ?? PRESENCE_HEARTBEAT_MS;
  }

  /** How many folders this pod holds a socket for. */
  get sessionCount(): number {
    return this.sockets.size;
  }

  /**
   * Authenticates the upgrade, then waits for the register frame. Holds the first frame (sent
   * before auth resolves) and drops later ones, so an unauthenticated peer cannot fill memory.
   */
  async accept(ws: ProtocolConnection, credentials: LocalControlConnectCredentials): Promise<void> {
    let held: string | undefined;
    const stopHolding = ws.onMessage((raw) => {
      held ??= raw;
    });

    const authenticated = await this.core.authenticate(credentials);
    stopHolding();
    if (!authenticated.ok) {
      this.refuse(ws, authenticated.code, authenticated.message);
      return;
    }

    const credential = authenticated.credential;
    if (held !== undefined) {
      void this.register(ws, credential, held);
      return;
    }
    const stopWaiting = ws.onMessage((raw) => {
      stopWaiting();
      void this.register(ws, credential, raw);
    });
  }

  /** Handles the register frame: presence, subscription, reply, pending calls. */
  private async register(
    ws: ProtocolConnection,
    credential: ControlCredential,
    raw: string,
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

    ws.onMessage((data) => void this.onFrame(live, data));
    ws.onPong(() => {
      live.pongs += 1;
    });
    ws.onClose(() => void this.detach(live));
    ws.onError((error) => {
      logger.warn(
        { error, conversationId: live.session.conversationId },
        "local control socket error",
      );
    });
    this.startClocks(live);

    // The socket may have gone while the registration ran, with no close listener on it yet.
    if (!ws.open) {
      await this.detach(live);
      return;
    }

    this.send(ws, registered.reply);

    // The turn that says "your folder is connected", and every call written while it was away.
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

  private async onFrame(live: LiveSocket, raw: string): Promise<void> {
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
      // Each ping carries its own deadline, so a pong inside the wait keeps the socket.
      const pongsBefore = live.pongs;
      live.socket.ping();
      setTimeout(() => {
        if (live.pongs !== pongsBefore) return;
        if (!live.socket.open) return;
        logger.warn(
          { conversationId: live.session.conversationId },
          "no pong inside the wait, closing the local control socket",
        );
        live.socket.terminate();
      }, this.pongWaitMs).unref();
    }, this.pingIntervalMs);
    live.ping.unref();

    // Presence is refreshed only while the socket is open, never off the ping's own flag.
    live.heartbeat = setInterval(() => {
      if (live.released) return;
      if (!live.socket.open) return;
      void this.beat(live);
    }, this.pingIntervalMs);
    live.heartbeat.unref();
  }

  /** One heartbeat, and a line the first time its answer changes. */
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
      // Retired, not merely quiet: a quiet socket kept receiving the newer folder's work.
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

  /** The socket is gone, the folder maybe not: drops only what this process holds. */
  private async detach(live: LiveSocket): Promise<void> {
    if (!this.sockets.has(live)) return;
    this.sockets.delete(live);
    if (live.ping) clearInterval(live.ping);
    if (live.heartbeat) clearInterval(live.heartbeat);
    await live.unsubscribe?.();
  }

  /** The command line said it is leaving: the folder is cleared and its calls fail at once. */
  private async exit(live: LiveSocket): Promise<void> {
    const held = this.sockets.has(live);
    await this.detach(live);
    if (!held) return;
    await this.core.retire(live.session, "cli_exit");
  }

  private refuse(ws: ProtocolConnection, code: LocalControlRefusedCode, message: string): void {
    this.send(ws, { type: "refused", protocol: LOCAL_CONTROL_PROTOCOL_VERSION, code, message });
    ws.close(POLICY_VIOLATION_CLOSE_CODE, code);
  }

  /** Writes one frame. False when the frame did not leave this process. */
  private send(ws: ProtocolConnection, frame: PlatformFrame): boolean {
    if (!ws.open) return false;
    try {
      return ws.send(JSON.stringify(frame));
    } catch (error) {
      logger.warn({ error, type: frame.type }, "local control write failed");
      return false;
    }
  }

  /** Closes every socket with 1012; a restart is not a disconnect, so the folders stay shared. */
  async close(): Promise<void> {
    for (const live of Array.from(this.sockets)) {
      live.socket.close(SERVICE_RESTART_CLOSE_CODE, "service restart");
      await this.detach(live);
    }
  }
}

function parseCliFrame(raw: string): CliFrame | null {
  try {
    const parsed = cliFrameSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
