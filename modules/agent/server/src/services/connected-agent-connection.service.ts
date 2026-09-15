import {
  AgentRegisterRefusedError,
  PING_INTERVAL_MS,
  PONG_WAIT_MS,
  PRESENCE_REFRESH_MS,
  PROTOCOL_VERSION,
  type PlatformFrame,
  type SdkFrame,
  sdkFrameSchema,
} from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import { type InstanceNudge, instanceNudgeSchema } from "@langwatch/agent-contract";
import { instanceChannel, pendingKey } from "../rules/connected-agent-keys.rules.ts";
import { AgentSessionService, type SessionInfo } from "./connected-agent-session.service.ts";
import type { Unsubscribe } from "@langwatch/redis-client/session-state";
import type { AgentConnection, AgentConnectCredentials } from "@langwatch/agent-contract";
import type { ResolvedConnectCredential } from "./connected-agent-credential.service.ts";

const logger = createLogger("langwatch:connected-agents:gateway");

/** Close code for a service restart: the SDK reconnects at once. */
const SERVICE_RESTART_CLOSE_CODE = 1012;

/** Close code for a refused connection: the SDK prints and backs off. */
const POLICY_VIOLATION_CLOSE_CODE = 1008;

export interface ConnectedAgentConnectionOptions {
  session: AgentSessionService;
  pingIntervalMs?: number;
  pongWaitMs?: number;
}

/** One connected process, after its register frame was accepted. */
interface Session {
  socket: AgentConnection;
  info: SessionInfo;
  unsubscribe: Unsubscribe | null;
  /** Calls the socket is working on; used to fail them on close. */
  activeCallIds: Set<string>;
  isAlive: boolean;
  /** Pongs seen so far, so each ping can tell whether its own was answered. */
  pongs: number;
  refresh: NodeJS.Timeout | null;
  ping: NodeJS.Timeout | null;
}

export class ConnectedAgentConnectionService {
  readonly #core: AgentSessionService;
  readonly #pingIntervalMs: number;
  readonly #pongWaitMs: number;
  readonly #sessions = new Set<Session>();

  static create(options: ConnectedAgentConnectionOptions): ConnectedAgentConnectionService {
    return new ConnectedAgentConnectionService(options);
  }

  private constructor(options: ConnectedAgentConnectionOptions) {
    this.#core = options.session;
    this.#pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
    this.#pongWaitMs = options.pongWaitMs ?? PONG_WAIT_MS;
  }

  /** How many processes hold a socket on this pod. */
  get sessionCount(): number {
    return this.#sessions.size;
  }

  /**
   * Authenticates the upgrade, then waits for the register frame. Every
   * refusal is one `refused` frame followed by a close.
   */
  async accept(ws: AgentConnection, credentials: AgentConnectCredentials): Promise<void> {
    const findReplicaRefusal = this.#core.findReplicaRefusal();
    if (findReplicaRefusal) {
      this.#refuse(ws, findReplicaRefusal);
      return;
    }

    // The SDK sends its register frame the moment the socket opens, which is before the
    // credential lookup below has answered. The first frame is held until then, so it is never
    // lost to an unattached listener. Later frames are dropped: only the register frame is
    // read here, and a peer that is not authenticated yet must not be able to fill the memory
    // of the process with the frames after it.
    let held: string | undefined;
    const hold = (raw: string) => {
      held ??= raw;
    };
    const releaseHeldFrame = ws.onMessage(hold);

    let resolved: ResolvedConnectCredential;
    try {
      resolved = await this.#core.authenticate(credentials);
    } catch (error) {
      releaseHeldFrame();
      this.#refuse(ws, error);
      return;
    }

    releaseHeldFrame();
    if (held !== void 0) {
      void this.#register(ws, resolved, held);
      return;
    }
    const release = ws.onMessage((raw) => {
      release();
      void this.#register(ws, resolved, raw);
    });
  }

  /** Handles the register frame: rows, presence, subscriptions, reply. */
  async #register(
    ws: AgentConnection,
    resolved: ResolvedConnectCredential,
    raw: string,
  ): Promise<void> {
    const parsed = findSdkFrame(raw);
    if (parsed?.type !== "register") {
      this.#refuse(
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
      ({ session: info, registered } = await this.#core.registerInstance({
        frame,
        resolved,
        heartbeatIntervalMs: this.#pingIntervalMs,
      }));
    } catch (error) {
      this.#refuse(ws, error);
      return;
    }

    const session: Session = {
      socket: ws,
      info,
      unsubscribe: null,
      activeCallIds: new Set(frame.instance.inFlightCallIds),
      isAlive: true,
      pongs: 0,
      refresh: null,
      ping: null,
    };
    this.#sessions.add(session);
    try {
      session.unsubscribe = await this.#core.runtime.store.subscribe(
        instanceChannel(info.projectId, info.instanceId),
        (message) =>
          void this.#onInstanceNudge(session, message).catch((error: unknown) => {
            logger.warn({ error, instanceId: info.instanceId }, "instance nudge failed");
          }),
      );
    } catch (error) {
      await this.#onClose(session).catch((cleanupError: unknown) => {
        logger.warn(
          { error: cleanupError, instanceId: info.instanceId },
          "registration cleanup failed",
        );
      });
      this.#refuse(ws, error);
      return;
    }

    this.#listen(session);

    // The socket may have gone while the registration was still running, with
    // no close listener on it yet. Retire the session rather than leave its
    // presence refreshing for a peer that is not there.
    if (!ws.open) {
      await this.#onClose(session);
      return;
    }

    this.#send(ws, registered);

    // Calls written for this instance while it was away.
    await this.#deliverPending(session).catch((error: unknown) => {
      logger.warn({ error, instanceId: info.instanceId }, "pending call delivery failed");
      ws.close(1011, "pending call delivery failed");
    });
  }

  #listen(session: Session): void {
    const { socket: ws, info } = session;
    ws.onMessage((data) => {
      void this.#onFrame(session, data).catch((error: unknown) => {
        logger.warn({ error, instanceId: info.instanceId }, "frame refused");
      });
    });
    ws.onPong(() => {
      session.isAlive = true;
      session.pongs += 1;
    });
    ws.onClose(
      () =>
        void this.#onClose(session).catch((error: unknown) => {
          logger.warn({ error, instanceId: info.instanceId }, "session cleanup failed");
        }),
    );
    ws.onError((error) => {
      logger.warn({ error, instanceId: info.instanceId }, "socket error");
    });
    this.#startClocks(session);
  }

  /** Sends every call still pending for this instance. */
  async #deliverPending(session: Session): Promise<void> {
    const callIds = await this.#core.runtime.store.zrangebyscore(
      pendingKey(session.info.projectId, session.info.instanceId),
      this.#core.now(),
    );
    for (const callId of callIds) {
      if (session.activeCallIds.has(callId)) continue;
      await this.#deliverCall(session, callId);
    }
  }

  /** Reads one envelope and sends it, if it is for an agent of this socket. */
  async #deliverCall(session: Session, callId: string): Promise<void> {
    const stored = await this.#core.findCallForSession(session.info, callId);
    if (!stored) return;
    // The call counts as in flight only once the frame is written. A socket
    // that went away between the nudge and the write never carried it, so the
    // dispatcher is told to place the call again rather than to give up.
    const sent = this.#send(session.socket, this.#core.callFrame(stored));
    if (!sent) {
      await this.#core.undeliver(session.info, callId);
      return;
    }
    session.activeCallIds.add(callId);
  }

  async #onInstanceNudge(session: Session, raw: string): Promise<void> {
    let nudge: InstanceNudge;
    try {
      nudge = instanceNudgeSchema.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if ("call" in nudge) {
      await this.#deliverCall(session, nudge.call);
      return;
    }
    session.activeCallIds.delete(nudge.cancel);
    this.#send(session.socket, {
      type: "cancel",
      protocol: PROTOCOL_VERSION,
      callId: nudge.cancel,
    });
  }

  async #onFrame(session: Session, raw: string): Promise<void> {
    const frame = findSdkFrame(raw);
    if (!frame) return;
    switch (frame.type) {
      case "ack":
        await this.#core.ack(session.info, frame.callId);
        return;
      case "result":
        session.activeCallIds.delete(frame.callId);
        await this.#core.result(session.info, frame);
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
  #startClocks(session: Session): void {
    session.ping = setInterval(() => {
      // Each ping carries its own deadline, so a pong that lands inside the
      // wait keeps the socket even when the next ping already went out, and
      // an earlier deadline can never retire a socket that has answered since.
      const pongsBefore = session.pongs;
      session.isAlive = false;
      session.socket.ping();
      setTimeout(() => {
        if (session.pongs !== pongsBefore) return;
        if (!session.socket.open) return;
        logger.warn(
          { instanceId: session.info.instanceId },
          "no pong inside the wait, closing the socket",
        );
        session.socket.terminate();
      }, this.#pongWaitMs).unref();
    }, this.#pingIntervalMs);
    session.ping.unref();

    session.refresh = setInterval(() => {
      if (!session.isAlive) return;
      void this.#core.refreshPresence(session.info).catch((error: unknown) => {
        logger.warn({ error, instanceId: session.info.instanceId }, "presence refresh failed");
      });
    }, PRESENCE_REFRESH_MS);
    session.refresh.unref();
  }

  /** The socket is gone: retire presence, fail its calls, tell every pod. */
  async #onClose(session: Session): Promise<void> {
    if (!this.#sessions.has(session)) return;
    this.#sessions.delete(session);
    if (session.ping) clearInterval(session.ping);
    if (session.refresh) clearInterval(session.refresh);
    try {
      await session.unsubscribe?.();
    } finally {
      await this.#core.retire(session.info, session.activeCallIds);
    }
  }

  #refuse(ws: AgentConnection, error: unknown): void {
    const { frame, refused } = this.#core.refusal(error);
    this.#send(ws, frame);
    ws.close(POLICY_VIOLATION_CLOSE_CODE, String(refused.meta.reason));
  }

  /** Writes one frame. False when the frame did not leave this process. */
  #send(ws: AgentConnection, frame: PlatformFrame): boolean {
    if (!ws.open) return false;
    try {
      return ws.send(JSON.stringify(frame));
    } catch (error) {
      logger.warn({ error, type: frame.type }, "socket write failed");
      return false;
    }
  }

  /** Closes every socket with 1012 so the SDKs reconnect at once. */
  async close(): Promise<void> {
    for (const session of this.#sessions) {
      session.socket.close(SERVICE_RESTART_CLOSE_CODE, "service restart");
      await this.#onClose(session);
    }
  }
}

function findSdkFrame(raw: string): SdkFrame | null {
  try {
    const parsed = sdkFrameSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
