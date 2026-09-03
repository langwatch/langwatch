/**
 * The HTTP side of connected agents, for a process whose network blocks
 * WebSockets (ADR-128, "Transport"): the same frames, carried by three
 * requests. `register` answers with the registered frame and an instance
 * token; `poll` waits for the next call and cancel frames of that instance
 * and refreshes its presence; `frames` takes ack, result and deregister.
 *
 * A session lives in the state store under its token, so a poll may land on
 * any pod. A pod that served an instance keeps a subscription on its channel
 * until the presence TTL passes with no poll, which is what wakes a waiting
 * poll and what tells the dispatcher an instance still exists between two
 * polls. Delivery is once only: a call is claimed under its own key before
 * it is handed out, so two polls never carry the same call.
 */

import {
  AgentRegisterRefusedError,
  AgentSessionUnknownError,
  CALL_KEY_SLACK_SECONDS,
  HTTP_SESSION_TTL_SECONDS,
  MAX_CALL_TIMEOUT_MS,
  POLL_WAIT_MS,
  PRESENCE_TTL_SECONDS,
  PROTOCOL_VERSION,
  type CallFrame,
  type CancelFrame,
  type RefusedFrame,
  type RegisteredFrame,
  registerFrameSchema,
  type SdkFrame,
} from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  type InstanceNudge,
  instanceNudgeSchema,
} from "../adapters/connected-agent-envelope.adapter";
import type { InstanceMeta } from "../adapters/connected-agent-registry.adapter";
import {
  callDeliveredKey,
  callKey,
  httpSessionKey,
  instanceChannel,
  instanceMetaKey,
  pendingKey,
  type Unsubscribe,
} from "../adapters/connected-agent-state.adapter";
import type { ConnectedAgentRuntime } from "./connected-agent-runtime.service";
import {
  AgentSessionCore,
  type ConnectCredentials,
  type SessionCoreOptions,
  type SessionInfo,
} from "./connected-agent-session.service";

const logger = createLogger("langwatch:connected-agents:long-poll");

/** The instance token an HTTP session is addressed by. */
export const INSTANCE_TOKEN_HEADER = "x-agent-instance-token";

/** The most call ids a poll may announce as in flight. */
const MAX_IN_FLIGHT_IDS = 1000;

/**
 * Slack past the presence TTL before a pod concludes an instance is gone:
 * the meta hash it reads expires with that TTL, and a poll on another pod
 * inside the window has renewed it.
 */
const GONE_CHECK_SLACK_MS = 5_000;

/** The delivered marker outlives the longest call and its slack. */
const DELIVERED_TTL_SECONDS =
  Math.ceil(MAX_CALL_TIMEOUT_MS / 1000) + CALL_KEY_SLACK_SECONDS;

/** What the store keeps for one HTTP session, under its token. */
const storedSessionSchema = z.object({
  token: z.string(),
  instanceId: z.string(),
  projectId: z.string(),
  projectSlug: z.string(),
  agentIds: z.array(z.string()),
  meta: z.object({
    instanceId: z.string(),
    projectId: z.string(),
    hostname: z.string(),
    username: z.string(),
    pid: z.number(),
    sdk: z.object({
      name: z.string(),
      version: z.string(),
      language: z.string(),
    }),
    label: z.string().nullable(),
    podId: z.string(),
    connectedAt: z.number(),
    maxConcurrency: z.number(),
  }),
});
type StoredSession = z.infer<typeof storedSessionSchema>;

/** The response of the register route. */
export interface RegisterAnswer {
  status: number;
  body: { frame: RegisteredFrame | RefusedFrame; instanceToken?: string };
}

/** What one pod keeps per instance it has served: the channel, and who waits on it. */
interface Watch {
  session: SessionInfo;
  unsubscribe: Unsubscribe;
  waiters: Set<(nudge: InstanceNudge) => void>;
  expiry: NodeJS.Timeout;
}

export interface LongPollTransportOptions extends SessionCoreOptions {
  /** How long a poll waits for a frame before it answers empty. */
  pollWaitMs?: number;
  /** How long a pod keeps a watch after its last poll; test knob. */
  watchTtlMs?: number;
}

export class LongPollTransport {
  private readonly core: AgentSessionCore;
  private readonly pollWaitMs: number;
  private readonly watchTtlMs: number;
  private readonly watches = new Map<string, Watch>();
  private closed = false;

  constructor(options: LongPollTransportOptions) {
    this.core = new AgentSessionCore(options);
    this.pollWaitMs = options.pollWaitMs ?? POLL_WAIT_MS;
    this.watchTtlMs =
      options.watchTtlMs ?? PRESENCE_TTL_SECONDS * 1000 + GONE_CHECK_SLACK_MS;
  }

  /** How many instances this pod watches. */
  get watchCount(): number {
    return this.watches.size;
  }

  /**
   * Registers the agents of a process and opens its session. Every refusal
   * is a `refused` frame with the status of its reason.
   */
  async register({
    credentials,
    body,
  }: {
    credentials: ConnectCredentials;
    body: unknown;
  }): Promise<RegisterAnswer> {
    const replicaRefusal = this.core.replicaRefusal();
    if (replicaRefusal) return this.refused(replicaRefusal);

    let resolved: Awaited<ReturnType<AgentSessionCore["authenticate"]>>;
    try {
      resolved = await this.core.authenticate(credentials);
    } catch (error) {
      return this.refused(error);
    }

    const parsed = registerFrameSchema.safeParse(body);
    if (!parsed.success) {
      return this.refused(
        new AgentRegisterRefusedError({
          reason: "protocol_invalid",
          message: `The body must be a register frame with protocol ${PROTOCOL_VERSION}.`,
        }),
      );
    }
    const frame = parsed.data;

    let session: SessionInfo;
    let registered: RegisteredFrame;
    try {
      ({ session, registered } = await this.core.registerInstance({
        frame,
        resolved,
        heartbeatIntervalMs: this.pollWaitMs,
      }));
    } catch (error) {
      return this.refused(error);
    }

    const token = `ait_${nanoid(32)}`;
    await this.saveSession({
      token,
      instanceId: session.instanceId,
      projectId: session.projectId,
      projectSlug: session.projectSlug,
      agentIds: [...session.agentIds],
      meta: session.meta,
    });
    // The calls the process says it is still working on are never handed
    // out again, the way a socket re-register skips them.
    for (const callId of frame.instance.inFlightCallIds) {
      await this.core.runtime.store.setIfAbsent(
        callDeliveredKey(callId),
        "1",
        DELIVERED_TTL_SECONDS,
      );
    }
    await this.ensureWatch(session);
    return { status: 200, body: { frame: registered, instanceToken: token } };
  }

  /**
   * Waits up to the poll wait for the next frames of an instance, and
   * refreshes its presence on the way in and on the way out.
   *
   * @throws {AgentRegisterRefusedError} the credential is refused
   * @throws {AgentSessionUnknownError} the token names no live session
   */
  async poll({
    credentials,
    token,
    inFlightCallIds,
    signal,
  }: {
    credentials: ConnectCredentials;
    token: string | undefined;
    inFlightCallIds: string[];
    signal?: AbortSignal;
  }): Promise<{ frames: (CallFrame | CancelFrame)[] }> {
    const { session, stored } = await this.openSession({ credentials, token });
    const watch = await this.ensureWatch(session);
    await this.touch(stored, session);
    const frames = await this.collectFrames({
      session,
      watch,
      inFlight: new Set(inFlightCallIds.slice(0, MAX_IN_FLIGHT_IDS)),
      signal,
    });
    if (!this.closed) await this.touch(stored, session);
    return { frames };
  }

  /** Drains what is waiting, or waits for a nudge until the poll wait passes. */
  private async collectFrames({
    session,
    watch,
    inFlight,
    signal,
  }: {
    session: SessionInfo;
    watch: Watch;
    inFlight: Set<string>;
    signal?: AbortSignal;
  }): Promise<(CallFrame | CancelFrame)[]> {
    const frames: (CallFrame | CancelFrame)[] = [];
    const deadline = this.core.now() + this.pollWaitMs;
    for (;;) {
      frames.push(...(await this.drain({ session, inFlight })));
      const remaining = deadline - this.core.now();
      if (this.settled({ frames, signal }) || remaining <= 0) return frames;
      const nudge = await this.waitForNudge({ watch, ms: remaining, signal });
      const outcome = nudgeOutcome({ nudge, closed: this.closed });
      if (outcome === "stop") return frames;
      if (outcome === "drain") continue;
      inFlight.delete(outcome.cancel);
      frames.push({
        type: "cancel",
        protocol: PROTOCOL_VERSION,
        callId: outcome.cancel,
      });
    }
  }

  /**
   * Takes the frames a process posts: ack, result and deregister.
   *
   * @throws {AgentRegisterRefusedError} the credential is refused
   * @throws {AgentSessionUnknownError} the token names no live session
   */
  async frames({
    credentials,
    token,
    frames,
  }: {
    credentials: ConnectCredentials;
    token: string | undefined;
    frames: Exclude<SdkFrame, { type: "register" }>[];
  }): Promise<{ accepted: number }> {
    const { session, stored } = await this.openSession({ credentials, token });
    for (const frame of frames) {
      switch (frame.type) {
        case "ack":
          await this.core.ack(session, frame.callId);
          break;
        case "result":
          await this.core.result(session, frame);
          break;
        case "deregister":
          await this.deregister(stored, session);
          return { accepted: frames.length };
      }
    }
    return { accepted: frames.length };
  }

  /** Releases every waiting poll and every watch; sessions stay in the store. */
  async close(): Promise<void> {
    this.closed = true;
    for (const [instanceId, watch] of this.watches) {
      this.watches.delete(instanceId);
      clearTimeout(watch.expiry);
      for (const waiter of watch.waiters) waiter({ cancel: "" });
      await watch.unsubscribe();
    }
  }

  private refused(error: unknown): RegisterAnswer {
    return this.refusedAnswer(error);
  }

  /** The refused frame for a credential error, with the status of its reason. */
  refusedAnswer(error: unknown): RegisterAnswer {
    const { frame } = this.core.refusal(error);
    return { status: refusalStatus(frame.code), body: { frame } };
  }

  private async openSession({
    credentials,
    token,
  }: {
    credentials: ConnectCredentials;
    token: string | undefined;
  }): Promise<{ session: SessionInfo; stored: StoredSession }> {
    const resolved = await this.core.authenticate(credentials);
    if (!token) throw new AgentSessionUnknownError();
    const raw = await this.core.runtime.store.get(httpSessionKey(token));
    if (!raw) throw new AgentSessionUnknownError();
    const parsed = storedSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.projectId !== resolved.project.id) {
      throw new AgentSessionUnknownError();
    }
    const stored = parsed.data;
    return {
      stored,
      session: {
        instanceId: stored.instanceId,
        projectId: stored.projectId,
        projectSlug: stored.projectSlug,
        agentIds: new Set(stored.agentIds),
        meta: stored.meta as InstanceMeta,
      },
    };
  }

  private async saveSession(stored: StoredSession): Promise<void> {
    await this.core.runtime.store.set(
      httpSessionKey(stored.token),
      JSON.stringify(stored),
      HTTP_SESSION_TTL_SECONDS,
    );
  }

  /** A poll is a heartbeat: the session and the presence both live on. */
  private async touch(
    stored: StoredSession,
    session: SessionInfo,
  ): Promise<void> {
    await this.saveSession(stored);
    await this.core.refreshPresence(session);
  }

  /**
   * The frames an instance has waiting: every pending call not yet handed
   * out, and a cancel for every call it holds whose envelope is gone.
   */
  private async drain({
    session,
    inFlight,
  }: {
    session: SessionInfo;
    inFlight: Set<string>;
  }): Promise<(CallFrame | CancelFrame)[]> {
    const store = this.core.runtime.store;
    const frames: (CallFrame | CancelFrame)[] = [];
    const pending = await store.zrangebyscore(
      pendingKey(session.instanceId),
      this.core.now(),
    );
    for (const callId of pending) {
      if (inFlight.has(callId)) continue;
      const claimed = await store.setIfAbsent(
        callDeliveredKey(callId),
        "1",
        DELIVERED_TTL_SECONDS,
      );
      if (!claimed) continue;
      const call = await this.core.readCallForSession(session, callId);
      if (call) frames.push(this.core.callFrame(call));
    }
    for (const callId of inFlight) {
      if (await store.get(callKey(callId))) continue;
      // The dispatcher deletes the envelope when it cancels a call.
      frames.push({ type: "cancel", protocol: PROTOCOL_VERSION, callId });
    }
    return frames;
  }

  /** A poll answers as soon as it holds a frame, or when its request or this pod is going away. */
  private settled({
    frames,
    signal,
  }: {
    frames: unknown[];
    signal?: AbortSignal;
  }): boolean {
    return frames.length > 0 || signal?.aborted === true || this.closed;
  }

  private waitForNudge({
    watch,
    ms,
    signal,
  }: {
    watch: Watch;
    ms: number;
    signal?: AbortSignal;
  }): Promise<InstanceNudge | null> {
    return new Promise((resolve) => {
      const finish = (nudge: InstanceNudge | null) => {
        clearTimeout(timer);
        watch.waiters.delete(waiter);
        signal?.removeEventListener("abort", onAbort);
        resolve(nudge);
      };
      const waiter = (nudge: InstanceNudge) => finish(nudge);
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), ms);
      watch.waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Subscribes this pod to the instance's channel, or extends the watch it holds. */
  private async ensureWatch(session: SessionInfo): Promise<Watch> {
    const existing = this.watches.get(session.instanceId);
    if (existing) {
      existing.session = session;
      existing.expiry.refresh();
      return existing;
    }
    const watch: Watch = {
      session,
      unsubscribe: async () => undefined,
      waiters: new Set(),
      expiry: setTimeout(
        () => void this.expireWatch(session.instanceId),
        this.watchTtlMs,
      ),
    };
    watch.expiry.unref();
    this.watches.set(session.instanceId, watch);
    watch.unsubscribe = await this.core.runtime.store.subscribe(
      instanceChannel(session.instanceId),
      (raw) => {
        let nudge: InstanceNudge;
        try {
          nudge = instanceNudgeSchema.parse(JSON.parse(raw));
        } catch {
          return;
        }
        for (const waiter of [...watch.waiters]) waiter(nudge);
      },
    );
    return watch;
  }

  /**
   * No poll reached this pod inside the TTL. When no pod did, the instance
   * is gone and the calls it held fail now; otherwise only this pod's
   * watch is dropped.
   */
  private async expireWatch(instanceId: string): Promise<void> {
    const watch = this.watches.get(instanceId);
    if (!watch) return;
    this.watches.delete(instanceId);
    await watch.unsubscribe();
    const live = await this.core.runtime.store.hgetall(
      instanceMetaKey(instanceId),
    );
    if (live) return;
    const pending = await this.core.runtime.store.zrangebyscore(
      pendingKey(instanceId),
      0,
    );
    logger.info({ instanceId }, "instance stopped polling, retiring it");
    await this.core.retire(watch.session, pending);
  }

  private async deregister(
    stored: StoredSession,
    session: SessionInfo,
  ): Promise<void> {
    const store = this.core.runtime.store;
    await store.del(httpSessionKey(stored.token));
    const watch = this.watches.get(session.instanceId);
    if (watch) {
      this.watches.delete(session.instanceId);
      clearTimeout(watch.expiry);
      for (const waiter of watch.waiters) waiter({ cancel: "" });
      await watch.unsubscribe();
    }
    const pending = await store.zrangebyscore(
      pendingKey(session.instanceId),
      0,
    );
    await this.core.retire(session, pending);
  }
}

/**
 * What a poll does with a nudge: no nudge is the wait passing or the request
 * going away, an empty cancel is the wake of a closing watch, a call means
 * the pending set is read again, and a cancel is a frame.
 */
function nudgeOutcome({
  nudge,
  closed,
}: {
  nudge: InstanceNudge | null;
  closed: boolean;
}): "stop" | "drain" | { cancel: string } {
  if (!nudge || closed) return "stop";
  if ("call" in nudge) return "drain";
  return nudge.cancel ? { cancel: nudge.cancel } : "stop";
}

/** The HTTP status a refusal answers with, by its code. */
export function refusalStatus(code: RefusedFrame["code"]): number {
  switch (code) {
    case "api_key_invalid":
      return 401;
    case "project_required":
      return 400;
    case "permission_denied":
    case "key_type_not_allowed":
      return 403;
    case "replica_count_unsupported":
      return 503;
    case "parameters_invalid":
    case "environment_invalid":
    case "protocol_invalid":
      return 422;
  }
}
