/**
 * The socket that carries Langy's local calls to this machine.
 *
 * One outbound connection to `/api/v1/langy/control/connect`, authorised with
 * the Langy session key the approval minted. It is the same transport the
 * connected-agents SDK uses (a WebSocket, falling back to HTTP long polling
 * when a proxy refuses the upgrade) and the same reconnect loop, both taken
 * from `src/agent/` rather than copied.
 *
 * The client owns the connection and nothing else: what a call does is
 * `session.ts`, what may run is `policy.ts`.
 */

import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { LANGWATCH_SDK_VERSION } from "../../../internal/constants";
import { resolveEndpoint } from "../../../internal/endpoint";
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  parsePlatformFrame,
  PRESENCE_HEARTBEAT_MS,
  serializeLocalFrame,
  type LocalCall,
  type LocalCliFrame,
  type LocalPlatformFrame,
  type LocalRefusedFrame,
  type LocalRegisteredFrame,
  type WorkspaceInfo,
} from "../../../agent/local-control-protocol";
import {
  describeError,
  NoWebSocketError,
  openTransportSocket,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  reconnectDelayMs,
  watchdogDelayMs,
} from "../../../agent/reconnect";
import {
  type AgentTransport,
  resolveTransport,
  type SocketFactory,
  type SocketLike,
} from "../../../agent/transport";

export const CONTROL_CONNECT_PATH = "/api/v1/langy/control/connect";

/** The socket URL for an endpoint, `https` becoming `wss` and `http` `ws`. */
export function resolveControlSocketUrl(endpoint?: string | null): string {
  const base = resolveEndpoint(endpoint);
  const socketBase = base.replace(/^http(s?):\/\//i, (_match, secure: string) =>
    secure ? "wss://" : "ws://",
  );
  return `${socketBase}${CONTROL_CONNECT_PATH}`;
}

/** The base of the long-poll routes: register, poll and frames hang off it. */
export function resolveControlHttpUrl(endpoint?: string | null): string {
  return `${resolveEndpoint(endpoint)}${CONTROL_CONNECT_PATH}`;
}

/** What the session does with what arrives on the socket. */
export interface RelayHandlers {
  onRegistered: (frame: LocalRegisteredFrame) => void;
  onCall: (call: LocalCall) => void;
  onCancel: (callId: string) => void;
  onPermission: (input: { callId: string; decision: string }) => void;
  onPolicy: (input: { skipPermissions: boolean }) => void;
  onDisconnect: (input: { reason: string }) => void;
  /** The platform refused the connection; the client stops on its own. */
  onRefused: (frame: LocalRefusedFrame) => void;
  /** A live connection dropped, so the session can say so once. */
  onConnectionLost: (input: { code?: number; message: string }) => void;
  /** The client gave up: no socket implementation, or a refusal. */
  onGaveUp: (input: { reason: string }) => void;
}

export interface RelayClientConfig {
  endpoint?: string;
  sessionKey: string;
  workspace: WorkspaceInfo;
  handlers: RelayHandlers;
  transport?: AgentTransport;
  socketFactory?: SocketFactory;
  /** Reconnect delays, for tests. Defaults to 1 s doubling up to 30 s. */
  backoff?: { baseMs: number; maxMs: number };
}

const CLOSE_GRACE_MS = 500;

const machineName = (): string => {
  try {
    return os.hostname();
  } catch {
    return "";
  }
};

const machineUser = (): string => {
  try {
    return os.userInfo().username;
  } catch {
    return "";
  }
};

export class RelayClient {
  private readonly url: string;
  private readonly httpUrl: string;
  private readonly headers: Record<string, string>;
  private readonly handlers: RelayHandlers;
  private readonly workspace: WorkspaceInfo;
  private readonly openSocket?: SocketFactory;
  private readonly backoff: { baseMs: number; maxMs: number };
  private readonly instanceId = `cli_${randomUUID().replace(/-/g, "")}`;
  private readonly startedAt = new Date().toISOString();
  /** Calls this process is working on, re-sent on every register. */
  private readonly inFlight = new Set<string>();

  private activeTransport: AgentTransport;
  private upgradeStatus: number | null = null;
  private socket: SocketLike | null = null;
  private registered = false;
  private stopped = false;
  private attempt = 0;
  private connectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = PRESENCE_HEARTBEAT_MS;
  private closeWaiters: Array<() => void> = [];
  private lastError: string | null = null;

  constructor(config: RelayClientConfig) {
    this.url = resolveControlSocketUrl(config.endpoint);
    this.httpUrl = resolveControlHttpUrl(config.endpoint);
    this.activeTransport = resolveTransport({ explicit: config.transport });
    this.headers = {
      Authorization: `Bearer ${config.sessionKey}`,
      "User-Agent": `langwatch-cli/${LANGWATCH_SDK_VERSION}`,
    };
    this.handlers = config.handlers;
    this.workspace = config.workspace;
    this.openSocket = config.socketFactory;
    this.backoff = config.backoff ?? {
      baseMs: RECONNECT_BASE_MS,
      maxMs: RECONNECT_MAX_MS,
    };
  }

  get isRegistered(): boolean {
    return this.registered;
  }

  /** The transport in use: the configured one, or HTTP after a refused upgrade. */
  get transport(): AgentTransport {
    return this.activeTransport;
  }

  start(): void {
    this.scheduleConnect(0);
  }

  /** Remembers a call so a reconnect tells the platform it is still running. */
  noteInFlight(callId: string): void {
    this.inFlight.add(callId);
  }

  forgetInFlight(callId: string): void {
    this.inFlight.delete(callId);
  }

  send(frame: LocalCliFrame): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.send(serializeLocalFrame(frame));
    } catch {
      // The socket is on its way out; the reconnect re-sends the register.
    }
  }

  /** Sends deregister, closes the socket and stops reconnecting. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    if (!socket) return;
    if (this.registered) {
      this.send({
        type: "deregister",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      });
    }
    const closed = new Promise<void>((resolve) => this.closeWaiters.push(resolve));
    try {
      socket.close(1000, "deregister");
    } catch {
      // Already gone.
    }
    const grace = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          socket.terminate();
        } catch {
          // Already gone.
        }
        resolve();
      }, CLOSE_GRACE_MS);
      timer.unref();
    });
    await Promise.race([closed, grace]);
  }

  /** Deregister with no wait, for a process that is already exiting. */
  stopNow(): void {
    this.stopped = true;
    this.clearTimers();
    if (!this.socket) return;
    try {
      if (this.registered) {
        this.send({
          type: "deregister",
          protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        });
      }
      this.socket.close(1000, "deregister");
    } catch {
      // Already gone.
    }
  }

  private scheduleConnect(delayMs: number): void {
    if (this.stopped || this.connectTimer || this.socket) return;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      this.connect();
    }, delayMs);
  }

  private clearTimers(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private giveUp(reason: string): void {
    this.stopped = true;
    this.clearTimers();
    this.handlers.onGaveUp({ reason });
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    let socket: SocketLike;
    try {
      socket = openTransportSocket({
        transport: this.activeTransport,
        websocketUrl: this.url,
        httpUrl: this.httpUrl,
        headers: this.headers,
        ...(this.openSocket ? { socketFactory: this.openSocket } : {}),
      });
    } catch (error) {
      if (error instanceof NoWebSocketError) {
        this.giveUp(
          "the ws package is not installed. Run npm install ws, or set LANGWATCH_AGENT_TRANSPORT=http.",
        );
        return;
      }
      this.lastError = describeError(error);
      this.onClosed();
      return;
    }
    this.socket = socket;
    socket.onOpen(() => this.send(this.registerFrame()));
    socket.onMessage((data) => this.onMessage(data));
    socket.onError((error) => {
      this.lastError = describeError(error);
    });
    socket.onPing(() => this.armWatchdog());
    socket.onUpgradeRefused?.((status) => {
      this.upgradeStatus = status;
    });
    socket.onClose((code) => this.onClosed(code));
  }

  private onClosed(code?: number): void {
    const wasRegistered = this.registered;
    this.socket = null;
    this.registered = false;
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    for (const waiter of this.closeWaiters.splice(0)) waiter();
    if (this.stopped) return;
    if (this.upgradeStatus !== null && this.activeTransport === "websocket") {
      // A proxy answered the upgrade with a status: the socket can never open
      // here, and the same frames travel over plain HTTP.
      this.upgradeStatus = null;
      this.activeTransport = "http";
      this.scheduleConnect(0);
      return;
    }
    if (wasRegistered) {
      this.handlers.onConnectionLost({
        ...(code === undefined ? {} : { code }),
        message: this.lastError ?? "the connection to LangWatch dropped",
      });
    }
    const delay = reconnectDelayMs({ attempt: this.attempt, ...this.backoff });
    this.attempt += 1;
    this.scheduleConnect(delay);
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    const socket = this.socket;
    if (!socket) return;
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      try {
        socket.terminate();
      } catch {
        // The close event follows either way.
      }
    }, watchdogDelayMs(this.heartbeatIntervalMs));
    this.watchdog.unref();
  }

  private registerFrame(): LocalCliFrame {
    return {
      type: "register",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      cli: { name: "langwatch", version: LANGWATCH_SDK_VERSION },
      instance: {
        id: this.instanceId,
        hostname: machineName(),
        username: machineUser(),
        pid: process.pid,
        startedAt: this.startedAt,
        inFlightCallIds: [...this.inFlight],
      },
      workspace: this.workspace,
    };
  }

  private onMessage(data: string): void {
    const frame = parsePlatformFrame(data);
    if (!frame) return;
    this.armWatchdog();
    this.dispatch(frame);
  }

  private dispatch(frame: LocalPlatformFrame): void {
    switch (frame.type) {
      case "registered":
        this.registered = true;
        this.attempt = 0;
        this.heartbeatIntervalMs = frame.heartbeatIntervalMs;
        this.armWatchdog();
        this.handlers.onRegistered(frame);
        return;
      case "refused":
        this.handlers.onRefused(frame);
        this.stopped = true;
        this.clearTimers();
        try {
          this.socket?.close(1000, frame.code);
        } catch {
          // The platform closes after refused either way.
        }
        return;
      case "call":
        this.handlers.onCall(frame.call);
        return;
      case "cancel":
        this.handlers.onCancel(frame.callId);
        return;
      case "permission":
        this.handlers.onPermission({
          callId: frame.callId,
          decision: frame.decision,
        });
        return;
      case "policy":
        this.handlers.onPolicy({ skipPermissions: frame.skipPermissions });
        return;
      case "disconnect":
        this.handlers.onDisconnect({ reason: frame.reason });
        return;
    }
  }
}
