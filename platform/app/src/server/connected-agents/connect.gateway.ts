/**
 * The socket side of connected agents: `GET /api/agents/connect` upgrades,
 * authenticates, registers the process's agents and holds the socket for
 * every call the dispatcher writes for its instance (ADR-128, "Transport").
 *
 * The gateway reads envelopes off Redis, never off the nudge message, and
 * rescans the instance's pending set when it registers, so a call written
 * while the socket was reconnecting is still delivered. It publishes the
 * instance as gone when the socket closes, so the dispatcher fails that
 * instance's calls at once instead of at the deadline. What a session means
 * to the platform lives in `AgentSessionCore`, shared with the HTTP
 * long-poll transport; this file owns the socket and its clocks.
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createLogger } from "@langwatch/observability";
import { WebSocket, WebSocketServer } from "ws";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import type { UpgradeRouter } from "~/server/websockets/upgrade-router";
import { type InstanceNudge, instanceNudgeSchema } from "./call-envelope";
import {
  PING_INTERVAL_MS,
  PONG_WAIT_MS,
  PRESENCE_REFRESH_MS,
  relayPayloadCaps,
} from "./constants";
import { AgentRegisterRefusedError } from "./errors";
import { instanceChannel, pendingKey } from "./keys";
import {
  type PlatformFrame,
  PROTOCOL_VERSION,
  sdkFrameSchema,
} from "./protocol";
import type { ConnectedAgentRuntime } from "./runtime";
import { AgentSessionCore, type SessionInfo } from "./session.core";
import type { Unsubscribe } from "./state-store";

const logger = createLogger("langwatch:connected-agents:gateway");

export const CONNECT_PATH = "/api/agents/connect";

/** Close code for a service restart: the SDK reconnects at once. */
const SERVICE_RESTART_CLOSE_CODE = 1012;

/** Close code for a refused connection: the SDK prints and backs off. */
const POLICY_VIOLATION_CLOSE_CODE = 1008;

export interface ConnectGatewayOptions {
  runtime: ConnectedAgentRuntime;
  prisma: PrismaClient;
  /** The app replicas of this deployment, for the no-Redis refusal. */
  replicaCount: number;
  now?: () => number;
  pingIntervalMs?: number;
  pongWaitMs?: number;
}

/** One connected process, after its register frame was accepted. */
interface Session {
  socket: WebSocket;
  info: SessionInfo;
  unsubscribe: Unsubscribe | null;
  /** Calls the socket is working on; used to fail them on close. */
  activeCallIds: Set<string>;
  isAlive: boolean;
  refresh: NodeJS.Timeout | null;
  ping: NodeJS.Timeout | null;
}

export class ConnectGateway {
  private readonly wss: WebSocketServer;
  private readonly core: AgentSessionCore;
  private readonly pingIntervalMs: number;
  private readonly pongWaitMs: number;
  private readonly sessions = new Set<Session>();

  constructor(options: ConnectGatewayOptions) {
    this.core = new AgentSessionCore({
      runtime: options.runtime,
      prisma: options.prisma,
      replicaCount: options.replicaCount,
      now: options.now,
    });
    this.pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
    this.pongWaitMs = options.pongWaitMs ?? PONG_WAIT_MS;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: relayPayloadCaps().frameBytes,
    });
  }

  /** Mounts the upgrade path on the shared router. */
  mount(router: UpgradeRouter): void {
    router.register(CONNECT_PATH, (request, socket, head) =>
      this.upgrade(request, socket, head),
    );
  }

  /** How many processes hold a socket on this pod. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  private upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      void this.accept(ws, request);
    });
  }

  /**
   * Authenticates the upgrade, then waits for the register frame. Every
   * refusal is one `refused` frame followed by a close.
   */
  private async accept(ws: WebSocket, request: IncomingMessage): Promise<void> {
    const replicaRefusal = this.core.replicaRefusal();
    if (replicaRefusal) {
      this.refuse(ws, replicaRefusal);
      return;
    }

    // The SDK sends its register frame the moment the socket opens, which
    // is before the credential lookup below has answered. The first frame is
    // held until then, so it is never lost to an unattached listener. Later
    // frames are dropped: only the register frame is read here, and a peer
    // that is not authenticated yet must not be able to fill the memory of
    // the process with the frames after it.
    let held: WebSocket.RawData | undefined;
    const hold = (raw: WebSocket.RawData) => {
      held ??= raw;
    };
    ws.on("message", hold);

    let resolved: ResolvedToken;
    try {
      const projectHeader = request.headers["x-project-id"];
      resolved = await this.core.authenticate({
        authorization: request.headers.authorization,
        projectId: Array.isArray(projectHeader)
          ? projectHeader[0]
          : projectHeader,
      });
    } catch (error) {
      ws.off("message", hold);
      this.refuse(ws, error);
      return;
    }

    ws.off("message", hold);
    if (held !== undefined) {
      void this.register(ws, resolved, held);
      return;
    }
    ws.once("message", (raw: WebSocket.RawData) => {
      void this.register(ws, resolved, raw);
    });
  }

  /** Handles the register frame: rows, presence, subscriptions, reply. */
  private async register(
    ws: WebSocket,
    resolved: ResolvedToken,
    raw: WebSocket.RawData,
  ): Promise<void> {
    const parsed = parseSdkFrame(raw);
    if (parsed?.type !== "register") {
      this.refuse(
        ws,
        new AgentRegisterRefusedError({
          reason: "protocol_invalid",
          message: `The first frame must be a register frame with protocol ${PROTOCOL_VERSION}.`,
        }),
      );
      return;
    }
    const frame = parsed;

    let info: SessionInfo;
    let registered: PlatformFrame;
    try {
      ({ session: info, registered } = await this.core.registerInstance({
        frame,
        resolved,
        heartbeatIntervalMs: this.pingIntervalMs,
      }));
    } catch (error) {
      this.refuse(ws, error);
      return;
    }

    const session: Session = {
      socket: ws,
      info,
      unsubscribe: null,
      activeCallIds: new Set(frame.instance.inFlightCallIds),
      isAlive: true,
      refresh: null,
      ping: null,
    };
    this.sessions.add(session);
    session.unsubscribe = await this.core.runtime.store.subscribe(
      instanceChannel(info.instanceId),
      (message) => void this.onInstanceNudge(session, message),
    );

    ws.on("message", (data) => void this.onFrame(session, data));
    ws.on("pong", () => {
      session.isAlive = true;
    });
    ws.on("close", () => void this.onClose(session));
    ws.on("error", (error) => {
      logger.warn({ error, instanceId: info.instanceId }, "socket error");
    });
    this.startClocks(session);

    this.send(ws, registered);

    // Calls written for this instance while it was away.
    await this.deliverPending(session);
  }

  /** Sends every call still pending for this instance. */
  private async deliverPending(session: Session): Promise<void> {
    const callIds = await this.core.runtime.store.zrangebyscore(
      pendingKey(session.info.instanceId),
      this.core.now(),
    );
    for (const callId of callIds) {
      if (session.activeCallIds.has(callId)) continue;
      await this.deliverCall(session, callId);
    }
  }

  /** Reads one envelope and sends it, if it is for an agent of this socket. */
  private async deliverCall(session: Session, callId: string): Promise<void> {
    const stored = await this.core.readCallForSession(session.info, callId);
    if (!stored) return;
    // The call counts as in flight only once the frame is written. A socket
    // that went away between the nudge and the write never carried it, so the
    // dispatcher is told to place the call again rather than to give up.
    if (!this.send(session.socket, this.core.callFrame(stored))) {
      await this.core.undeliver(session.info, callId);
      return;
    }
    session.activeCallIds.add(callId);
  }

  private async onInstanceNudge(session: Session, raw: string): Promise<void> {
    let nudge: InstanceNudge;
    try {
      nudge = instanceNudgeSchema.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if ("call" in nudge) {
      await this.deliverCall(session, nudge.call);
      return;
    }
    session.activeCallIds.delete(nudge.cancel);
    this.send(session.socket, {
      type: "cancel",
      protocol: PROTOCOL_VERSION,
      callId: nudge.cancel,
    });
  }

  private async onFrame(
    session: Session,
    raw: WebSocket.RawData,
  ): Promise<void> {
    const frame = parseSdkFrame(raw);
    if (!frame) return;
    switch (frame.type) {
      case "ack":
        await this.core.ack(session.info, frame.callId);
        return;
      case "result":
        session.activeCallIds.delete(frame.callId);
        await this.core.result(session.info, frame);
        return;
      case "deregister":
        session.socket.close(1000, "deregister");
        return;
      case "register":
        // A second register on an open socket is ignored; the SDK reconnects
        // with a fresh socket to change what it serves.
        return;
    }
  }

  /** Presence refresh on the SDK's pongs, and the ping that asks for them. */
  private startClocks(session: Session): void {
    session.ping = setInterval(() => {
      if (!session.isAlive) {
        logger.warn(
          { instanceId: session.info.instanceId },
          "no pong inside the wait, closing the socket",
        );
        session.socket.terminate();
        return;
      }
      session.isAlive = false;
      session.socket.ping();
      setTimeout(() => {
        if (!session.isAlive && session.socket.readyState === WebSocket.OPEN) {
          session.socket.terminate();
        }
      }, this.pongWaitMs).unref();
    }, this.pingIntervalMs);
    session.ping.unref();

    session.refresh = setInterval(() => {
      if (!session.isAlive) return;
      void this.core.refreshPresence(session.info);
    }, PRESENCE_REFRESH_MS);
    session.refresh.unref();
  }

  /** The socket is gone: retire presence, fail its calls, tell every pod. */
  private async onClose(session: Session): Promise<void> {
    if (!this.sessions.has(session)) return;
    this.sessions.delete(session);
    if (session.ping) clearInterval(session.ping);
    if (session.refresh) clearInterval(session.refresh);
    await session.unsubscribe?.();
    await this.core.retire(session.info, session.activeCallIds);
  }

  private refuse(ws: WebSocket, error: unknown): void {
    const { frame, refused } = this.core.refusal(error);
    this.send(ws, frame);
    ws.close(POLICY_VIOLATION_CLOSE_CODE, String(refused.meta.reason));
  }

  /** Writes one frame. False when the frame did not leave this process. */
  private send(ws: WebSocket, frame: PlatformFrame): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      logger.warn({ error, type: frame.type }, "socket write failed");
      return false;
    }
  }

  /** Closes every socket with 1012 so the SDKs reconnect at once. */
  async close(): Promise<void> {
    for (const session of [...this.sessions]) {
      session.socket.close(SERVICE_RESTART_CLOSE_CODE, "service restart");
      await this.onClose(session);
    }
    // A socket that never registered, or whose peer is not reading, would
    // keep the server open past the shutdown budget.
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

function parseSdkFrame(raw: WebSocket.RawData) {
  try {
    const parsed = sdkFrameSchema.safeParse(JSON.parse(rawToString(raw)));
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
