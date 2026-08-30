/**
 * Dispatches one call to one live instance and waits for its answer (ADR-128,
 * "Transport", "Concurrency", "Timeouts").
 *
 * Durable and at most once: the envelope is written to Redis and to the
 * instance's pending set before the instance channel is nudged, the SDK
 * acknowledges when the function starts, and a call is retried on another
 * instance only before that acknowledgement. The result lands in a key and a
 * nudge on this pod's reply channel; the key is polled as the fallback.
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import {
  buildCallEnvelope,
  type CallOutcome,
  type InstanceNudge,
  instanceGoneSchema,
  replyNudgeSchema,
  type StoredCall,
  storedResultSchema,
} from "./call-envelope";
import {
  BUSY_RETRY_AFTER_MS,
  CALL_KEY_SLACK_SECONDS,
  FIRST_TURN_GRACE_MS,
  FIRST_TURN_POLL_MS,
  RESULT_POLL_MS,
  STICKY_PIN_TTL_SECONDS,
} from "./constants";
import {
  AgentBusyError,
  AgentCallFailedError,
  AgentCallTimeoutError,
  AgentDisconnectedError,
  AgentInstanceLostError,
  AgentOfflineError,
  AgentPayloadTooLargeError,
} from "./errors";
import type { InstanceRegistry, LiveInstance } from "./instance.registry";
import {
  callAckKey,
  callKey,
  INSTANCE_GONE_CHANNEL,
  instanceChannel,
  pendingKey,
  replyChannel,
  resultKey,
  threadPinKey,
} from "./keys";
import type { CallEnvelope } from "./protocol";
import type { AgentStateStore, Unsubscribe } from "./state-store";

const logger = createLogger("langwatch:connected-agents:dispatcher");

/** What the relay route hands the dispatcher for one turn. */
export interface DispatchCall {
  threadId: string;
  messages: CallEnvelope["messages"];
  newMessages: CallEnvelope["newMessages"];
  params: CallEnvelope["params"];
  session: unknown;
  traceparent: string | null;
  run: CallEnvelope["run"];
}

/** What the dispatcher needs to know about the agent. */
export interface DispatchAgent {
  id: string;
  name: string;
  environment: string | null;
  /** The per-call budget, already capped by the caller. */
  timeoutMs: number;
  sticky: boolean;
}

export interface DispatchParams {
  projectId: string;
  agent: DispatchAgent;
  call: DispatchCall;
  /** Aborted when the relay request goes away; the call is cancelled. */
  signal?: AbortSignal;
  now?: () => number;
}

type Waiter = {
  resolve: (outcome: WaitOutcome) => void;
};

type WaitOutcome =
  | { kind: "result" }
  | { kind: "ack" }
  | { kind: "gone" }
  | { kind: "timeout" }
  | { kind: "aborted" };

export interface CallDispatcherOptions {
  podId: string;
  store: AgentStateStore;
  registry: InstanceRegistry;
  /** Test knob: how long the first turn waits for an instance. */
  firstTurnGraceMs?: number;
  firstTurnPollMs?: number;
  resultPollMs?: number;
}

/**
 * One dispatcher per pod: it owns this pod's reply subscription and the
 * in-memory map from call id to the waiter for it.
 */
export class CallDispatcher {
  private readonly podId: string;
  private readonly store: AgentStateStore;
  private readonly registry: InstanceRegistry;
  private readonly firstTurnGraceMs: number;
  private readonly firstTurnPollMs: number;
  private readonly resultPollMs: number;
  private readonly waiters = new Map<string, Waiter[]>();
  private readonly instanceOfCall = new Map<string, string>();
  private subscriptions: Unsubscribe[] | null = null;

  constructor(options: CallDispatcherOptions) {
    this.podId = options.podId;
    this.store = options.store;
    this.registry = options.registry;
    this.firstTurnGraceMs = options.firstTurnGraceMs ?? FIRST_TURN_GRACE_MS;
    this.firstTurnPollMs = options.firstTurnPollMs ?? FIRST_TURN_POLL_MS;
    this.resultPollMs = options.resultPollMs ?? RESULT_POLL_MS;
  }

  /** Subscribes this pod's reply channel and the instance-gone channel. */
  async start(): Promise<void> {
    if (this.subscriptions) return;
    this.subscriptions = await Promise.all([
      this.store.subscribe(replyChannel(this.podId), (raw) => {
        const nudge = parse(replyNudgeSchema, raw);
        if (!nudge) return;
        this.wake(nudge.callId, { kind: nudge.kind });
      }),
      this.store.subscribe(INSTANCE_GONE_CHANNEL, (raw) => {
        const gone = parse(instanceGoneSchema, raw);
        if (!gone) return;
        for (const [callId, instanceId] of this.instanceOfCall) {
          if (instanceId === gone.instanceId)
            this.wake(callId, { kind: "gone" });
        }
      }),
    ]);
  }

  async close(): Promise<void> {
    const subscriptions = this.subscriptions ?? [];
    this.subscriptions = null;
    await Promise.all(subscriptions.map((unsubscribe) => unsubscribe()));
    for (const [callId] of this.waiters) this.wake(callId, { kind: "aborted" });
  }

  /**
   * Sends one turn to one live instance and returns its answer.
   *
   * @throws {AgentOfflineError} no instance inside the first-turn grace
   * @throws {AgentBusyError} every instance at its concurrency
   * @throws {AgentInstanceLostError} a sticky thread's instance is gone
   * @throws {AgentDisconnectedError} the instance went away after it started
   * @throws {AgentCallTimeoutError} the deadline passed
   * @throws {AgentCallFailedError} the function raised
   */
  async dispatch(params: DispatchParams): Promise<CallOutcome> {
    await this.start();
    const now = params.now ?? (() => Date.now());
    const startedAt = now();
    const deadlineAt = startedAt + params.agent.timeoutMs;

    let excluded: string[] = [];
    let attempts = 0;
    for (;;) {
      throwIfAborted(params.signal);
      const instance = await this.pickInstance({ ...params, excluded, now });
      attempts += 1;
      const callId = `call_${nanoid()}`;
      const envelope = buildCallEnvelope({
        callId,
        agentId: params.agent.id,
        threadId: params.call.threadId,
        messages: params.call.messages,
        newMessages: params.call.newMessages,
        params: params.call.params,
        session: params.call.session,
        traceparent: params.call.traceparent,
        deadlineAt,
        run: params.call.run,
      });

      const outcome = await this.runOnInstance({
        projectId: params.projectId,
        instance,
        envelope,
        signal: params.signal,
        now,
        sticky: params.agent.sticky,
        timeoutMs: params.agent.timeoutMs,
      });
      if (outcome.kind === "answered") {
        return {
          ...outcome.answer,
          durationMs: now() - startedAt,
        };
      }
      // The instance left before the function started, and the call was
      // never acknowledged: it is safe to try once on another instance.
      if (outcome.kind === "retry" && attempts < 2) {
        excluded = [...excluded, instance.instanceId];
        logger.warn(
          { callId, instanceId: instance.instanceId, agentId: params.agent.id },
          "instance gone before ack, retrying the call on another instance",
        );
        continue;
      }
      throw new AgentDisconnectedError({ instanceId: instance.instanceId });
    }
  }

  /** Picks the instance for a call, or refuses in the way the ADR names. */
  private async pickInstance({
    projectId,
    agent,
    call,
    excluded,
    signal,
    now,
  }: DispatchParams & {
    excluded: string[];
    now: () => number;
  }): Promise<LiveInstance> {
    const pinKey = threadPinKey(agent.id, call.threadId);
    const pinned = agent.sticky ? await this.store.get(pinKey) : null;

    const waitUntil = now() + this.firstTurnGraceMs;
    for (;;) {
      throwIfAborted(signal);
      const live = (
        await this.registry.listLive({
          projectId,
          agentId: agent.id,
          now: now(),
        })
      ).filter((instance) => !excluded.includes(instance.instanceId));

      if (pinned) {
        const target = live.find((instance) => instance.instanceId === pinned);
        if (target) return target;
        throw new AgentInstanceLostError({ instanceId: pinned });
      }

      if (live.length > 0) {
        const free = live
          .map((instance) => ({
            instance,
            slots: instance.maxConcurrency - instance.inflight,
          }))
          .filter(({ slots }) => slots > 0);
        if (free.length === 0) {
          throw new AgentBusyError({ retryAfterMs: BUSY_RETRY_AFTER_MS });
        }
        const chosen = pickMostFree(free, call.threadId).instance;
        if (agent.sticky) {
          await this.store.set(
            pinKey,
            chosen.instanceId,
            STICKY_PIN_TTL_SECONDS,
          );
        }
        return chosen;
      }

      // The first turn of a thread waits for a process that is still
      // starting; later turns hit the same wait, which is short.
      if (now() >= waitUntil) {
        throw new AgentOfflineError({
          agentName: agent.name,
          environment: agent.environment,
        });
      }
      await sleep(Math.min(this.firstTurnPollMs, waitUntil - now()), signal);
    }
  }

  /** Writes, nudges and waits for one call on one instance. */
  private async runOnInstance({
    projectId,
    instance,
    envelope,
    signal,
    now,
    sticky,
    timeoutMs,
  }: {
    projectId: string;
    instance: LiveInstance;
    envelope: CallEnvelope;
    signal?: AbortSignal;
    now: () => number;
    sticky: boolean;
    timeoutMs: number;
  }): Promise<
    | { kind: "answered"; answer: Omit<CallOutcome, "durationMs"> }
    | { kind: "retry" }
    | { kind: "disconnected" }
  > {
    const { callId, deadlineAt } = envelope;
    const ttlSeconds =
      Math.ceil((deadlineAt - now()) / 1000) + CALL_KEY_SLACK_SECONDS;
    const stored: StoredCall = {
      projectId,
      envelope,
      replyTo: this.podId,
      instanceId: instance.instanceId,
    };

    this.instanceOfCall.set(callId, instance.instanceId);
    await this.registry.incrementInflight(instance.instanceId);
    await this.store.set(callKey(callId), JSON.stringify(stored), ttlSeconds);
    await this.store.zadd(
      pendingKey(instance.instanceId),
      deadlineAt,
      callId,
      ttlSeconds,
    );
    const receivers = await this.store.publish(
      instanceChannel(instance.instanceId),
      JSON.stringify({ call: callId } satisfies InstanceNudge),
    );

    try {
      if (receivers === 0 && this.store.shared) {
        // Nothing holds that instance's socket on any pod: the presence
        // entry outlived the process. Retire it and try another.
        await this.retire({ projectId, instance, agentId: envelope.agentId });
        return { kind: "retry" };
      }

      const outcome = await this.waitForResult({
        callId,
        deadlineAt,
        signal,
        now,
      });
      switch (outcome.kind) {
        case "result": {
          const result = await this.readResult(callId);
          if (!result || result.disconnected) {
            // The socket pod closed the call without an answer. Before the
            // function started that is safe to try elsewhere; after, it is
            // not, since the function may have run.
            const acknowledged = await this.store.get(callAckKey(callId));
            return acknowledged ? { kind: "disconnected" } : { kind: "retry" };
          }
          if (result.error) {
            throw remoteError(result.error);
          }
          if (sticky) {
            await this.store.set(
              threadPinKey(envelope.agentId, envelope.threadId),
              instance.instanceId,
              STICKY_PIN_TTL_SECONDS,
            );
          }
          return {
            kind: "answered",
            answer: {
              output: result.output ?? "",
              session: result.session,
              instance: {
                instanceId: instance.instanceId,
                hostname: instance.hostname,
                label: instance.label,
              },
            },
          };
        }
        case "gone": {
          const acknowledged = await this.store.get(callAckKey(callId));
          await this.retire({ projectId, instance, agentId: envelope.agentId });
          return acknowledged ? { kind: "disconnected" } : { kind: "retry" };
        }
        case "timeout":
          await this.cancel({ callId, instanceId: instance.instanceId });
          throw new AgentCallTimeoutError({ timeoutMs });
        case "aborted":
          await this.cancel({ callId, instanceId: instance.instanceId });
          throw abortError(signal);
        case "ack":
          throw new Error("ack is never a terminal outcome");
      }
    } finally {
      this.instanceOfCall.delete(callId);
      this.waiters.delete(callId);
      await this.registry.decrementInflight(instance.instanceId);
      await this.store.zrem(pendingKey(instance.instanceId), callId);
    }
  }

  /** Waits for a result nudge, a gone signal, the deadline or an abort. */
  private waitForResult({
    callId,
    deadlineAt,
    signal,
    now,
  }: {
    callId: string;
    deadlineAt: number;
    signal?: AbortSignal;
    now: () => number;
  }): Promise<WaitOutcome> {
    return new Promise<WaitOutcome>((resolve) => {
      let settled = false;
      const timers: NodeJS.Timeout[] = [];
      const finish = (outcome: WaitOutcome) => {
        if (settled) return;
        settled = true;
        for (const timer of timers) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const onAbort = () => finish({ kind: "aborted" });
      signal?.addEventListener("abort", onAbort, { once: true });

      const waiter: Waiter = {
        resolve: (outcome) => {
          // An ack keeps the wait going; it only changes what a later
          // disconnect means, which `runOnInstance` reads off the ack key.
          if (outcome.kind === "ack") return;
          finish(outcome);
        },
      };
      this.waiters.set(callId, [...(this.waiters.get(callId) ?? []), waiter]);

      const budget = Math.max(0, deadlineAt - now());
      timers.push(setTimeout(() => finish({ kind: "timeout" }), budget));

      // The poll is the fallback for a lost nudge: a subscriber that was
      // reconnecting when the gateway published never sees the message.
      const poll = async () => {
        if (settled) return;
        const result = await this.store
          .get(resultKey(callId))
          .catch(() => null);
        if (result) {
          finish({ kind: "result" });
          return;
        }
        timers.push(setTimeout(() => void poll(), this.resultPollMs));
      };
      timers.push(setTimeout(() => void poll(), this.resultPollMs));
    });
  }

  private wake(callId: string, outcome: WaitOutcome): void {
    for (const waiter of this.waiters.get(callId) ?? [])
      waiter.resolve(outcome);
  }

  private async readResult(callId: string) {
    const raw = await this.store.get(resultKey(callId));
    return raw ? parse(storedResultSchema, raw) : null;
  }

  /** Tells the instance to stop, and forgets the call. */
  private async cancel({
    callId,
    instanceId,
  }: {
    callId: string;
    instanceId: string;
  }): Promise<void> {
    await this.store.publish(
      instanceChannel(instanceId),
      JSON.stringify({ cancel: callId } satisfies InstanceNudge),
    );
    await this.store.del(callKey(callId));
  }

  /** Drops an instance the dispatcher found gone from presence. */
  private async retire({
    projectId,
    instance,
    agentId,
  }: {
    projectId: string;
    instance: LiveInstance;
    agentId: string;
  }): Promise<void> {
    await this.registry.deregister({
      projectId,
      instanceId: instance.instanceId,
      agentIds: [agentId],
    });
  }
}

/**
 * The error a result carries, as the handled error the caller reads.
 *
 * A gateway refusing an oversized result writes the payload code, which
 * keeps its own class; anything else is the function's own error.
 */
function remoteError(error: { code: string; message: string }): Error {
  if (error.code === "agent_payload_too_large") {
    const match = /is (\d+) bytes, above the limit of (\d+) bytes/.exec(
      error.message,
    );
    return new AgentPayloadTooLargeError({
      what: error.message.startsWith("The session") ? "session" : "result",
      sizeBytes: Number(match?.[1] ?? 0),
      limitBytes: Number(match?.[2] ?? 0),
    });
  }
  return new AgentCallFailedError({
    remoteCode: error.code,
    remoteMessage: error.message,
  });
}

/**
 * The instance with the most free slots; ties go to the rendezvous hash of
 * the thread, so a stateless agent still tends to see one thread from one
 * instance.
 */
function pickMostFree(
  free: { instance: LiveInstance; slots: number }[],
  threadId: string,
): { instance: LiveInstance; slots: number } {
  const best = Math.max(...free.map(({ slots }) => slots));
  const candidates = free.filter(({ slots }) => slots === best);
  if (candidates.length === 1) return candidates[0]!;
  return candidates
    .map((candidate) => ({
      candidate,
      weight: rendezvousWeight(threadId, candidate.instance.instanceId),
    }))
    .sort((left, right) => right.weight - left.weight)[0]!.candidate;
}

/** A stable weight per (thread, instance) pair: FNV-1a over both ids. */
function rendezvousWeight(threadId: string, instanceId: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${threadId}#${instanceId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function parse<T>(
  schema: { safeParse: (raw: unknown) => { success: boolean; data?: T } },
  raw: string,
): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as T) : null;
  } catch {
    return null;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error("The relay request was aborted");
  error.name = "AbortError";
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
