/**
 * One shared connection per process to `/api/v1/agents/connect`.
 *
 * The client holds every agent the process defined, registers them all on
 * one socket, answers `call` frames by running the agent's function, and
 * reconnects with backoff when the platform goes away. Nothing in here throws
 * into customer code: every frame is handled under a catch that logs, and a
 * failure on the LangWatch side produces one warning that names the fix and
 * leaves the application running as if the wrapper were absent.
 *
 * @see dev/docs/adr/128-connected-agents.md
 */

import { context, propagation, trace } from "@opentelemetry/api";
import type { Logger } from "../logger";
import type { AgentCall, AgentResult } from "./define";
import {
  buildConnectHeaders,
  buildInstance,
  resolveConnectUrl,
  resolveHttpConnectUrl,
  SDK_IDENTITY,
} from "./identity";
import {
  parseServerFrame,
  PROTOCOL_VERSION,
  serializeFrame,
  traceIdFromTraceparent,
  type AgentParameterValue,
  type CallFrame,
  type ClientFrame,
  type RefusedFrame,
  type RegisterAgent,
  type RegisterInstance,
  type RegisteredFrame,
} from "./protocol";
import { AgentParameterError, type ParameterReader } from "./schema";
import {
  type AgentTransport,
  defaultSocketFactory,
  HttpLongPollSocket,
  NoWebSocketError,
  resolveTransport,
  type SocketFactory,
  type SocketLike,
} from "./transport";

/** One defined agent as the client runs it. */
export interface AgentRuntime {
  name: string;
  environment: string;
  register: RegisterAgent;
  /** Defaults, coercion and the schema's own validation, before every call. */
  readParams: ParameterReader;
  concurrency: number;
  timeoutMs: number;
  run: (call: AgentCall<Record<string, AgentParameterValue>>) => Promise<AgentResult>;
}

export interface AgentClientConfig {
  apiKey: string;
  endpoint?: string;
  projectId?: string;
  instanceLabel?: string;
  /** `websocket` (default) or `http`; also `LANGWATCH_AGENT_TRANSPORT`. */
  transport?: AgentTransport;
  logger: Logger;
  socketFactory?: SocketFactory;
  /** Reconnect delays, for tests. Defaults to 1 s doubling up to 30 s. */
  backoff?: { baseMs: number; maxMs: number };
  /** How often the same unreachable-endpoint warning may repeat, for tests. */
  failureNoticeIntervalMs?: number;
}

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
/** The unreachable-endpoint warning repeats at most this often. */
export const FAILURE_NOTICE_INTERVAL_MS = 5 * 60_000;

/** The delay before reconnect attempt `attempt` (0-based), with jitter, in the 1 s to 30 s window. */
export function reconnectDelayMs({
  attempt,
  baseMs = RECONNECT_BASE_MS,
  maxMs = RECONNECT_MAX_MS,
  random = Math.random,
}: {
  attempt: number;
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 16));
  const jittered = exponential * (0.75 + random() * 0.5);
  return Math.round(Math.min(maxMs, Math.max(baseMs, jittered)));
}

const NOT_CONNECTED = "not connected to LangWatch";

/** The one line a refusal produces: what went wrong and what fixes it. */
export function refusalAdvice(frame: RefusedFrame): string {
  switch (frame.code) {
    case "project_required": {
      const projects = Array.isArray(frame.meta?.projects) ? frame.meta.projects : [];
      const listed = projects
        .map((project) => {
          const entry = project as { id?: unknown; name?: unknown };
          const id = typeof entry.id === "string" ? entry.id : "";
          const name = typeof entry.name === "string" ? entry.name : "";
          return name && id ? `${name} (${id})` : id || name;
        })
        .filter((line) => line !== "");
      return `the API key reaches more than one project. Set LANGWATCH_PROJECT_ID to one of: ${listed.length > 0 ? listed.join(", ") : "the projects the key reaches"}.`;
    }
    case "api_key_invalid":
      return "the API key is not valid. Set LANGWATCH_API_KEY to a key from the project settings.";
    case "key_type_not_allowed":
      return "this key type cannot connect agents. Set LANGWATCH_API_KEY to a personal or project API key.";
    case "permission_denied":
      return "the API key cannot manage scenarios. Use a key with the scenarios:manage permission.";
    case "protocol_invalid":
      return `${frame.message} Update the langwatch package to a version that speaks protocol ${PROTOCOL_VERSION} or later.`;
    case "replica_count_unsupported":
      return `${frame.message} Connected agents on a LangWatch deployment without Redis need one app replica.`;
    case "parameters_invalid":
    case "environment_invalid":
      return frame.message;
    default:
      return `${frame.message} (${frame.code})`;
  }
}

interface InFlightCall {
  runtime: AgentRuntime;
  /** True once the call was cancelled or timed out: a late result is dropped. */
  cancelled: boolean;
  /** The timer that ends the call on its deadline, cleared when the call ends. */
  timer: NodeJS.Timeout | null;
}

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;
type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

const CLOSE_GRACE_MS = 500;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class AgentClient {
  private readonly agents: AgentRuntime[] = [];
  private readonly byId = new Map<string, AgentRuntime>();
  private readonly inFlight = new Map<string, InFlightCall>();
  private readonly instance: RegisterInstance;
  private readonly url: string;
  private readonly httpUrl: string;
  private readonly headers: Record<string, string>;
  /** The transport in use: the configured one, or HTTP after a refused upgrade. */
  private activeTransport: AgentTransport;
  private upgradeStatus: number | null = null;
  private transportAnnounced = false;
  private readonly logger: Logger;
  private readonly openSocket: SocketFactory;
  private readonly backoff: { baseMs: number; maxMs: number };
  private readonly failureNoticeIntervalMs: number;

  private socket: SocketLike | null = null;
  private registered = false;
  private stopped = false;
  /** True while a socket is closed on purpose to register the full agent list again. */
  private restarting = false;
  private attempt = 0;
  private connectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 10_000;
  private closeWaiters: Array<() => void> = [];
  private lastError: string | null = null;
  private failureNoticeAt: number | null = null;
  private gaveUp = false;

  constructor(config: AgentClientConfig) {
    this.instance = buildInstance({ label: config.instanceLabel });
    this.url = resolveConnectUrl(config.endpoint);
    this.httpUrl = resolveHttpConnectUrl(config.endpoint);
    this.activeTransport = resolveTransport({ explicit: config.transport });
    this.headers = buildConnectHeaders({ apiKey: config.apiKey, projectId: config.projectId });
    this.logger = config.logger;
    this.openSocket = config.socketFactory ?? defaultSocketFactory;
    this.backoff = config.backoff ?? { baseMs: RECONNECT_BASE_MS, maxMs: RECONNECT_MAX_MS };
    this.failureNoticeIntervalMs = config.failureNoticeIntervalMs ?? FAILURE_NOTICE_INTERVAL_MS;
  }

  get instanceId(): string {
    return this.instance.id;
  }

  /** The transport the client speaks now. */
  get transport(): AgentTransport {
    return this.activeTransport;
  }

  get isRegistered(): boolean {
    return this.registered;
  }

  /** True once the client gave up: refused, or no socket implementation. No timer is left behind. */
  get isStopped(): boolean {
    return this.stopped;
  }

  /** True while a reconnect is scheduled with a timer that keeps the process up. */
  get hasPendingConnect(): boolean {
    return this.connectTimer?.hasRef() ?? false;
  }

  /** True while the client is between attempts or inside one, with the process kept up. */
  get isRetrying(): boolean {
    if (this.stopped) return false;
    return this.connectTimer ? this.connectTimer.hasRef() : this.socket !== null;
  }

  /** Adds an agent and connects on the next tick, or reconnects when a socket is already open. */
  addAgent(runtime: AgentRuntime): void {
    this.agents.push(runtime);
    if (this.gaveUp) {
      this.logger.debug(`agent "${runtime.name}" ${NOT_CONNECTED}: the connection gave up earlier in this process`);
      return;
    }
    this.stopped = false;
    if (this.socket) {
      // The platform ignores a second register on an open socket, whether the
      // first one is still on its way or already answered. A fresh socket
      // carries the complete list.
      this.restartSocket();
      return;
    }
    this.scheduleConnect(0);
  }

  /** Closes the socket and connects again at once, keeping the reconnect loop. */
  private restartSocket(): void {
    const socket = this.socket;
    if (!socket) return;
    this.restarting = true;
    try {
      socket.close(1000, "agents changed");
    } catch {
      this.restarting = false;
      this.socket = null;
      this.scheduleConnect(0);
    }
  }

  /** Removes an agent; the last one leaving deregisters and closes the socket. */
  async removeAgent(runtime: AgentRuntime): Promise<void> {
    const index = this.agents.indexOf(runtime);
    if (index !== -1) this.agents.splice(index, 1);
    for (const [id, agent] of this.byId) if (agent === runtime) this.byId.delete(id);
    if (this.agents.length === 0) {
      await this.disconnect();
      return;
    }
    // The open socket registered the agent that just left, and the platform
    // ignores a second register on it. A fresh socket carries the list as it
    // stands now.
    this.restartSocket();
  }

  /** Sends deregister, closes the socket and stops reconnecting. */
  async disconnect(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    if (!socket) return;
    if (this.registered) this.send({ type: "deregister", protocol: PROTOCOL_VERSION });
    const closed = new Promise<void>((resolve) => this.closeWaiters.push(resolve));
    try {
      socket.close(1000, "deregister");
    } catch {
      // The socket is already gone.
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
  shutdownNow(): void {
    this.stopped = true;
    this.clearTimers();
    if (!this.socket) return;
    try {
      if (this.registered) this.send({ type: "deregister", protocol: PROTOCOL_VERSION });
      this.socket.close(1000, "deregister");
    } catch {
      // The socket is already gone.
    }
  }

  private agentNames(): string {
    return this.agents.map((agent) => `"${agent.name}"`).join(", ") || "the agent";
  }

  /**
   * The reconnect timer keeps its ref on purpose: a script whose only job is
   * the agent must stay up while it retries. Giving up clears every timer.
   */
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
    this.gaveUp = true;
    this.clearTimers();
    this.logger.warn(`agent ${this.agentNames()} ${NOT_CONNECTED}: ${reason}`);
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    let socket: SocketLike;
    try {
      socket =
        this.activeTransport === "http"
          ? new HttpLongPollSocket({ url: this.httpUrl, headers: this.headers })
          : this.openSocket({ url: this.url, headers: this.headers });
    } catch (error) {
      if (error instanceof NoWebSocketError) {
        this.giveUp(
          "the ws package is not installed. Run npm install ws; the platform reads the API key from a request header, and only ws can send it.",
        );
        return;
      }
      this.lastError = describeError(error);
      this.onClosed();
      return;
    }
    this.socket = socket;
    socket.onOpen(() => this.guard(() => this.send(this.registerFrame())));
    socket.onMessage((data) => this.guard(() => this.onMessage(data)));
    socket.onError((error) => {
      this.lastError = describeError(error);
    });
    socket.onPing(() => this.armWatchdog());
    socket.onUpgradeRefused?.((status) => {
      this.upgradeStatus = status;
    });
    socket.onClose((code) => this.guard(() => this.onClosed(code)));
  }

  private onClosed(code?: number): void {
    const wasRegistered = this.registered;
    const restarting = this.restarting;
    this.restarting = false;
    this.socket = null;
    this.registered = false;
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    for (const waiter of this.closeWaiters.splice(0)) waiter();
    if (this.stopped) return;
    if (this.upgradeStatus !== null && this.activeTransport === "websocket") {
      // A proxy answered the upgrade with a status: the socket can never
      // open here, and the same frames travel over plain HTTP.
      const status = this.upgradeStatus;
      this.upgradeStatus = null;
      this.activeTransport = "http";
      this.logger.warn(
        `the WebSocket upgrade to ${this.url} was answered with HTTP ${status}; using the HTTP transport at ${this.httpUrl} instead`,
      );
      this.scheduleConnect(0);
      return;
    }
    if (restarting) {
      this.scheduleConnect(0);
      return;
    }
    const delay = reconnectDelayMs({ attempt: this.attempt, ...this.backoff });
    this.attempt += 1;
    this.noteDisconnected({ wasRegistered, code });
    this.scheduleConnect(delay);
  }

  /**
   * One warning when the platform cannot be reached, one when a live
   * connection is lost, and silence while the retries run: the same notice
   * repeats only after the notice interval, and a reconnect resets it.
   */
  private noteDisconnected({ wasRegistered, code }: { wasRegistered: boolean; code?: number }): void {
    const now = Date.now();
    if (wasRegistered) {
      this.logger.warn(
        `lost the connection to LangWatch${code === undefined ? "" : ` (${code})`}, reconnecting with backoff`,
      );
      this.failureNoticeAt = now;
      return;
    }
    const stale =
      this.failureNoticeAt === null || now - this.failureNoticeAt >= this.failureNoticeIntervalMs;
    if (!stale) return;
    this.failureNoticeAt = now;
    const cause = this.lastError ? ` (${this.lastError})` : "";
    this.logger.warn(
      `agent ${this.agentNames()} ${NOT_CONNECTED}: could not reach ${this.url}${cause}. Check LANGWATCH_ENDPOINT and the network; retrying with backoff.`,
    );
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    const socket = this.socket;
    if (!socket) return;
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      this.logger.warn("no heartbeat from LangWatch, reconnecting");
      try {
        socket.terminate();
      } catch {
        // The close event follows either way.
      }
    }, Math.max(15_000, this.heartbeatIntervalMs * 3));
  }

  private registerFrame(): ClientFrame {
    return {
      type: "register",
      protocol: PROTOCOL_VERSION,
      sdk: SDK_IDENTITY,
      instance: { ...this.instance, inFlightCallIds: [...this.inFlight.keys()] },
      agents: this.agents.map((agent) => agent.register),
    };
  }

  private send(frame: ClientFrame): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.send(serializeFrame(frame));
    } catch (error) {
      this.logger.debug(`could not send ${frame.type}: ${describeError(error)}`);
    }
  }

  private onMessage(data: string): void {
    const frame = parseServerFrame(data);
    if (!frame) {
      this.logger.debug("dropped a frame the SDK does not know");
      return;
    }
    this.armWatchdog();
    switch (frame.type) {
      case "registered":
        this.onRegistered(frame);
        return;
      case "refused":
        this.onRefused(frame);
        return;
      case "call":
        void this.onCall(frame);
        return;
      case "cancel": {
        const call = this.inFlight.get(frame.callId);
        if (!call) return;
        call.cancelled = true;
        // The handler may run for as long as it wants; the slot it held is
        // free at once, so the next call is not refused as busy.
        this.releaseCall({ callId: frame.callId, entry: call });
        return;
      }
    }
  }

  private onRefused(frame: RefusedFrame): void {
    this.giveUp(refusalAdvice(frame));
    try {
      this.socket?.close(1000, frame.code);
    } catch {
      // The platform closes after refused either way.
    }
  }

  private onRegistered(frame: RegisteredFrame): void {
    this.registered = true;
    this.attempt = 0;
    if (this.failureNoticeAt !== null) {
      this.logger.info("connected to LangWatch");
      this.failureNoticeAt = null;
    }
    if (this.activeTransport === "http" && !this.transportAnnounced) {
      this.transportAnnounced = true;
      this.logger.info(`connected to LangWatch over HTTP long polling at ${this.httpUrl}`);
    }
    this.heartbeatIntervalMs = frame.heartbeatIntervalMs;
    if (frame.instanceId && frame.instanceId !== this.instance.id) this.instance.id = frame.instanceId;
    this.byId.clear();
    for (const entry of frame.agents) {
      const runtime = this.agents.find(
        (agent) => agent.name === entry.name && agent.environment === entry.environment,
      );
      if (!runtime) continue;
      this.byId.set(entry.id, runtime);
      this.logger.info(
        `agent "${entry.name}" (${entry.environment}) is online${entry.url ? `: ${entry.url}` : ""}`,
      );
      for (const note of entry.parameterNotes) this.logger.warn(`agent "${entry.name}": ${note}`);
    }
    this.armWatchdog();
  }

  private async onCall(frame: CallFrame): Promise<void> {
    const runtime = this.byId.get(frame.agentId);
    if (!runtime) {
      this.sendError({
        callId: frame.callId,
        code: "agent_call_failed",
        message: `no agent registered as ${frame.agentId}`,
      });
      return;
    }
    const busy = [...this.inFlight.values()].filter((call) => call.runtime === runtime).length;
    if (busy >= runtime.concurrency) {
      this.sendError({
        callId: frame.callId,
        code: "agent_busy",
        message: `agent "${runtime.name}" has ${busy} call${busy === 1 ? "" : "s"} in flight, its limit`,
      });
      return;
    }
    if (frame.deadlineAt !== null && frame.deadlineAt <= Date.now()) {
      this.sendError({
        callId: frame.callId,
        code: "agent_call_timeout",
        message: "the call deadline passed before it started",
      });
      return;
    }

    // The slot is taken before the first await. Reading the parameters is
    // asynchronous, and a second call arriving inside that window would pass
    // the concurrency check above if the entry were written after it.
    const entry: InFlightCall = { runtime, cancelled: false, timer: null };
    this.inFlight.set(frame.callId, entry);

    let params: Record<string, AgentParameterValue>;
    try {
      params = await runtime.readParams(frame.params);
    } catch (error) {
      this.releaseCall({ callId: frame.callId, entry });
      this.sendError({
        callId: frame.callId,
        code: "agent_parameter_invalid",
        message: describeError(error),
      });
      return;
    }
    if (entry.cancelled) {
      this.releaseCall({ callId: frame.callId, entry });
      return;
    }

    // The ack means the function started: before it the platform may hand the
    // call to another instance, so it stays after the parameters are read.
    this.send({ type: "ack", protocol: PROTOCOL_VERSION, callId: frame.callId });
    this.armCallDeadline({ frame, entry, runtime });

    const parent = frame.traceparent
      ? propagation.extract(context.active(), { traceparent: frame.traceparent })
      : context.active();
    const traceId =
      trace.getSpanContext(parent)?.traceId ?? traceIdFromTraceparent(frame.traceparent) ?? "";

    const call: AgentCall<Record<string, AgentParameterValue>> = {
      messages: frame.messages,
      newMessages: frame.newMessages,
      threadId: frame.threadId,
      session: frame.session,
      params,
      traceId,
    };

    try {
      const result = await context.with(parent, () => runtime.run(call));
      if (entry.cancelled) return;
      await this.flushSpans();
      this.send({
        type: "result",
        protocol: PROTOCOL_VERSION,
        callId: frame.callId,
        output: result.output,
        ...(result.session === undefined ? {} : { session: result.session }),
      });
    } catch (error) {
      if (entry.cancelled) return;
      const code = error instanceof AgentParameterError ? error.code : "agent_call_failed";
      const message = describeError(error);
      this.logger.warn(`agent "${runtime.name}" call ${frame.callId} failed: ${message}`);
      await this.flushSpans();
      this.sendError({ callId: frame.callId, code, message });
    } finally {
      this.releaseCall({ callId: frame.callId, entry });
    }
  }

  /**
   * Exports the spans of the call now instead of at the exporter's next
   * schedule. The judge reads the agent's spans right after the last turn,
   * and a batch exporter would otherwise hold them for seconds, which is what
   * made the judge report the spans missing.
   *
   * The call awaits this before it sends its result or its error: the frame is
   * what tells the platform the turn is over, so a frame that goes out first
   * lets the judge read the call while its spans are still in the exporter.
   */
  private async flushSpans(): Promise<void> {
    const provider = trace.getTracerProvider() as { getDelegate?: () => unknown };
    const delegate =
      typeof provider.getDelegate === "function" ? provider.getDelegate() : provider;
    const flush = (delegate as { forceFlush?: () => Promise<void> } | null)?.forceFlush;
    if (typeof flush !== "function") return;
    try {
      await flush.call(delegate);
    } catch (error) {
      this.logger.debug(`span flush after a call failed: ${describeError(error)}`);
    }
  }

  /** Frees the slot the call holds and drops its deadline timer. */
  private releaseCall({ callId, entry }: { callId: string; entry: InFlightCall }): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (this.inFlight.get(callId) === entry) this.inFlight.delete(callId);
  }

  /**
   * The call ends on its deadline: one timeout result, and the slot is free
   * from that moment. A handler that never returns then costs one call, not
   * every call after it.
   */
  private armCallDeadline({
    frame,
    entry,
    runtime,
  }: {
    frame: CallFrame;
    entry: InFlightCall;
    runtime: AgentRuntime;
  }): void {
    const fromDeadline = frame.deadlineAt === null ? Infinity : frame.deadlineAt - Date.now();
    const limit = Math.min(fromDeadline, runtime.timeoutMs);
    if (!Number.isFinite(limit)) return;
    const timer = setTimeout(() => {
      entry.timer = null;
      if (entry.cancelled) return;
      // The handler keeps running: a function cannot be stopped from here.
      // Its late result is dropped, because the platform has an answer.
      entry.cancelled = true;
      this.releaseCall({ callId: frame.callId, entry });
      this.logger.warn(
        `agent "${runtime.name}" call ${frame.callId} passed its ${limit} ms limit`,
      );
      this.sendError({
        callId: frame.callId,
        code: "agent_call_timeout",
        message: `the call passed the ${limit} ms limit of agent "${runtime.name}"`,
      });
    }, Math.max(0, limit));
    timer.unref();
    entry.timer = timer;
  }

  private sendError({ callId, code, message }: { callId: string; code: string; message: string }): void {
    this.send({ type: "result", protocol: PROTOCOL_VERSION, callId, error: { code, message } });
  }

  private guard(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.error(`agent client error: ${describeError(error)}`);
    }
  }
}

let shared: AgentClient | null = null;
let sharedKey: string | null = null;
let hooksInstalled = false;
const noticesGiven = new Set<string>();
let testOverrides: Partial<AgentClientConfig> = {};

const signalHandlers = new Map<ShutdownSignal, () => void>();

const onShutdownSignal = (signal: ShutdownSignal): void => {
  const client = shared;
  const finish = () => {
    const handler = signalHandlers.get(signal);
    if (handler) process.removeListener(signal, handler);
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  if (!client) {
    finish();
    return;
  }
  void client.disconnect().finally(finish);
};

const onBeforeExit = (): void => {
  shared?.shutdownNow();
};

const installShutdownHooks = (): void => {
  if (hooksInstalled) return;
  hooksInstalled = true;
  for (const signal of SHUTDOWN_SIGNALS) {
    const handler = () => onShutdownSignal(signal);
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  process.on("beforeExit", onBeforeExit);
};

const removeShutdownHooks = (): void => {
  if (!hooksInstalled) return;
  hooksInstalled = false;
  for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  signalHandlers.clear();
  process.removeListener("beforeExit", onBeforeExit);
};

/** One warning per process for a condition every agent definition would repeat. */
export function warnOnce({ logger, key, message }: { logger: Logger; key: string; message: string }): void {
  if (noticesGiven.has(key)) {
    logger.debug(message);
    return;
  }
  noticesGiven.add(key);
  logger.warn(message);
}

/**
 * The one client of this process. The first agent's credentials and endpoint
 * are the ones used; a later agent that names different ones is told so and
 * shares the socket anyway.
 */
export function getSharedClient(config: AgentClientConfig): AgentClient {
  const key = `${config.endpoint ?? ""}|${config.projectId ?? ""}|${config.apiKey}`;
  if (shared) {
    if (sharedKey !== key) {
      warnOnce({
        logger: config.logger,
        key: "credentials-differ",
        message:
          "connectAgent: this process already has an agent connection with other credentials or endpoint; the first ones are used",
      });
    }
    return shared;
  }
  shared = new AgentClient({ ...config, ...testOverrides });
  sharedKey = key;
  installShutdownHooks();
  return shared;
}

/** Settings the next shared client is built with, on top of what the agent gave. For tests. */
export function overrideSharedClientForTests(overrides: Partial<AgentClientConfig>): void {
  testOverrides = overrides;
}

/** Drops the shared client so the next definition starts a new one. For tests. */
export async function resetSharedClient(): Promise<void> {
  const client = shared;
  shared = null;
  sharedKey = null;
  noticesGiven.clear();
  testOverrides = {};
  removeShutdownHooks();
  if (client) await client.disconnect();
}

/** The client the process shares right now, so a test can read its state. */
export function sharedClientForTests(): AgentClient | null {
  return shared;
}

/** The shutdown handlers as installed, so a test can drive a signal without raising it. */
export const shutdownForTests = { onShutdownSignal, onBeforeExit };
