import { clearTimeout, setTimeout } from "node:timers";

import {
  type AgentCallSignal,
  AgentCallTimeoutError,
  AgentDisconnectedError,
  AgentOfflineError,
  CALL_KEY_SLACK_SECONDS,
  type CallEnvelope,
  type CallOutcome,
  FIRST_TURN_GRACE_MS,
  FIRST_TURN_POLL_MS,
  RESULT_POLL_MS,
  buildCallEnvelope,
  type InstanceNudge,
  type StoredCall,
} from "@langwatch/agent-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { nowInstant } from "@langwatch/time";

import {
  pinnedInstance,
  chooseInstance,
} from "../rules/connected-agent-instance-selection.rules.ts";
import {
  callKey,
  instanceChannel,
  pendingKey,
  threadPinKey,
} from "../rules/connected-agent-keys.rules.ts";
import { ConnectedAgentAnswerService } from "./connected-agent-answer.service.ts";
import type { ConnectedAgentRegistryService } from "./connected-agent-registry.service.ts";
import { ConnectedAgentReplyService } from "./connected-agent-reply.service.ts";
import { type DispatchParams, type LiveInstance } from "./connected-agent-runtime.service.ts";

const logger = createLogger("langwatch:connected-agents:dispatcher");

/**
 * The app's KSUID resource for a call id (`KSUID_RESOURCES.CALL`). The
 * literal rather than the app's constant table: the prefix is part of the
 * id format already written to the store, so it belongs with the writer.
 */
const CALL_KSUID_RESOURCE = "call";

export interface CallDispatcherOptions {
  podId: string;
  store: SessionStateStore;
  registry: ConnectedAgentRegistryService;
  /** Test knob: how long the first turn waits for an instance. */
  firstTurnGraceMs?: number;
  firstTurnPollMs?: number;
  resultPollMs?: number;
}

export class ConnectedAgentDispatchService {
  static create(options: CallDispatcherOptions): ConnectedAgentDispatchService {
    return new ConnectedAgentDispatchService(options);
  }

  readonly #podId: string;
  readonly #store: SessionStateStore;
  readonly #registry: ConnectedAgentRegistryService;
  readonly #firstTurnGraceMs: number;
  readonly #firstTurnPollMs: number;
  readonly #replies: ConnectedAgentReplyService;
  readonly #answers: ConnectedAgentAnswerService;

  private constructor(options: CallDispatcherOptions) {
    this.#podId = options.podId;
    this.#store = options.store;
    this.#registry = options.registry;
    this.#firstTurnGraceMs = options.firstTurnGraceMs ?? FIRST_TURN_GRACE_MS;
    this.#firstTurnPollMs = options.firstTurnPollMs ?? FIRST_TURN_POLL_MS;
    this.#replies = ConnectedAgentReplyService.create({
      podId: options.podId,
      store: options.store,
      pollMs: options.resultPollMs ?? RESULT_POLL_MS,
    });
    this.#answers = ConnectedAgentAnswerService.create({ store: options.store });
  }

  start(): Promise<void> {
    return this.#replies.start();
  }

  close(): Promise<void> {
    return this.#replies.close();
  }

  /**
   * Sends one turn to one live instance and returns its answer.
   */
  async dispatch(params: DispatchParams): Promise<CallOutcome> {
    await this.start();
    const now = params.now ?? (() => nowInstant().epochMilliseconds);
    const startedAt = now();
    const deadlineAt = startedAt + params.agent.timeoutMs;

    const first = await this.#attempt({ params, excluded: [], now, deadlineAt });
    let last = first;
    // The instance left before the function started, and the call was
    // never acknowledged: it is safe to try once on another instance.
    if (first.outcome.kind === "retry") {
      logger.warn(
        { callId: first.callId, instanceId: first.instance.instanceId, agentId: params.agent.id },
        "instance gone before ack, retrying the call on another instance",
      );
      last = await this.#attempt({
        params,
        excluded: [first.instance.instanceId],
        now,
        deadlineAt,
      });
    }
    if (last.outcome.kind !== "answered") {
      throw new AgentDisconnectedError({ instanceId: last.instance.instanceId });
    }
    return {
      ...last.outcome.answer,
      durationMs: now() - startedAt,
    };
  }

  async #attempt({
    params,
    excluded,
    now,
    deadlineAt,
  }: {
    params: DispatchParams;
    excluded: string[];
    now: () => number;
    deadlineAt: number;
  }) {
    throwIfAborted(params.signal);
    const instance = await this.#pickInstance({ ...params, excluded, now });
    const callId = generate(CALL_KSUID_RESOURCE).toString();
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
    const outcome = await this.#runOnInstance({
      projectId: params.projectId,
      instance,
      envelope,
      signal: params.signal,
      now,
      isSticky: params.agent.isSticky,
      timeoutMs: params.agent.timeoutMs,
    });
    return { instance, callId, outcome };
  }

  /** Picks the instance for a call, or refuses in the way the ADR names. */
  async #pickInstance({
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
    const pinKey = threadPinKey(projectId, agent.id, call.threadId);
    const pinned = agent.isSticky ? await this.#store.tryGet(pinKey) : null;

    const waitUntil = now() + this.#firstTurnGraceMs;
    const findLive = (): Promise<LiveInstance[]> => {
      throwIfAborted(signal);
      return this.#liveInstances({ projectId, agentId: agent.id, excluded, now });
    };
    let live = await findLive();
    // The first turn of a thread waits for a process that is still
    // starting; later turns hit the same wait, which is short.
    while (!pinned && live.length === 0 && now() < waitUntil) {
      await sleep(Math.min(this.#firstTurnPollMs, waitUntil - now()), signal);
      live = await findLive();
    }

    if (pinned) return pinnedInstance(live, pinned);
    if (live.length === 0) {
      throw new AgentOfflineError({
        agentName: agent.name,
        environment: agent.environment,
      });
    }

    const chosen = chooseInstance(live, call.threadId);
    await this.#answers.pinThread({
      isSticky: agent.isSticky,
      pinKey,
      instanceId: chosen.instanceId,
    });
    return chosen;
  }

  /** The live instances of one agent, without the ones already tried. */
  async #liveInstances({
    projectId,
    agentId,
    excluded,
    now,
  }: {
    projectId: string;
    agentId: string;
    excluded: string[];
    now: () => number;
  }): Promise<LiveInstance[]> {
    const live = await this.#registry.listLive({
      projectId,
      agentId,
      now: now(),
    });
    return live.filter((instance) => !excluded.includes(instance.instanceId));
  }

  /** Writes, nudges and waits for one call on one instance. */
  async #runOnInstance({
    projectId,
    instance,
    envelope,
    signal,
    now,
    isSticky,
    timeoutMs,
  }: {
    projectId: string;
    instance: LiveInstance;
    envelope: CallEnvelope;
    signal?: AgentCallSignal;
    now: () => number;
    isSticky: boolean;
    timeoutMs: number;
  }): Promise<
    | { kind: "answered"; answer: Omit<CallOutcome, "durationMs"> }
    | { kind: "retry" }
    | { kind: "disconnected" }
  > {
    const { callId, deadlineAt } = envelope;

    this.#replies.track(callId, {
      projectId,
      instanceId: instance.instanceId,
    });
    await this.#registry.incrementInflight({
      projectId,
      instanceId: instance.instanceId,
    });

    try {
      // Inside the try, so a store that refuses the write still gives the
      // slot and the pending entry back through the finally.
      const receivers = await this.#postCall({
        projectId,
        instance,
        envelope,
        now,
      });
      if (receivers === 0 && this.#store.shared) {
        // Nothing holds that instance's socket on any pod: the presence
        // entry outlived the process. Retire it and try another.
        await this.#retire({ projectId, instance, agentId: envelope.agentId });
        return { kind: "retry" };
      }

      const outcome = await this.#replies.wait({
        projectId,
        callId,
        deadlineAt,
        signal,
        now,
      });
      switch (outcome.kind) {
        case "result":
          return await this.#answers.read({ projectId, instance, envelope, isSticky });
        case "gone": {
          // The frame reached a socket. Whether the instance acknowledged it
          // or not, the function may have started, so the turn is not placed
          // again. A frame that never left says so through the result, which
          // `readAnswer` reads.
          await this.#retire({ projectId, instance, agentId: envelope.agentId });
          if (await this.#answers.isUndelivered({ projectId, callId })) return { kind: "retry" };
          return { kind: "disconnected" };
        }
        case "timeout":
          await this.#cancel({ projectId, callId, instanceId: instance.instanceId });
          throw new AgentCallTimeoutError({ timeoutMs });
        case "aborted":
          await this.#cancel({ projectId, callId, instanceId: instance.instanceId });
          throw abortError(signal);
        case "ack":
          throw new Error("ack is never a terminal outcome");
      }
    } finally {
      this.#replies.release(callId);
      await this.#registry.decrementInflight({
        projectId,
        instanceId: instance.instanceId,
      });
      await this.#store.zrem(pendingKey(projectId, instance.instanceId), callId);
    }
  }

  /**
   * Writes the envelope, lists it as pending on the instance, and nudges the
   * instance channel. Resolves to how many subscribers took the nudge.
   */
  async #postCall({
    projectId,
    instance,
    envelope,
    now,
  }: {
    projectId: string;
    instance: LiveInstance;
    envelope: CallEnvelope;
    now: () => number;
  }): Promise<number> {
    const { callId, deadlineAt } = envelope;
    const ttlSeconds = Math.ceil((deadlineAt - now()) / 1000) + CALL_KEY_SLACK_SECONDS;
    const stored: StoredCall = {
      projectId,
      envelope,
      replyTo: this.#podId,
      instanceId: instance.instanceId,
    };

    await this.#store.set(callKey(projectId, callId), JSON.stringify(stored), ttlSeconds);
    await this.#store.zadd({
      key: pendingKey(projectId, instance.instanceId),
      score: deadlineAt,
      member: callId,
      ttlSeconds,
    });
    return this.#store.publish(
      instanceChannel(projectId, instance.instanceId),
      JSON.stringify({ call: callId } satisfies InstanceNudge),
    );
  }

  /** Tells the instance to stop, and forgets the call. */
  async #cancel({
    projectId,
    callId,
    instanceId,
  }: {
    projectId: string;
    callId: string;
    instanceId: string;
  }): Promise<void> {
    await this.#store.publish(
      instanceChannel(projectId, instanceId),
      JSON.stringify({ cancel: callId } satisfies InstanceNudge),
    );
    await this.#store.del(callKey(projectId, callId));
  }

  /** Drops an instance the dispatcher found gone from presence. */
  async #retire({
    projectId,
    instance,
    agentId,
  }: {
    projectId: string;
    instance: LiveInstance;
    agentId: string;
  }): Promise<void> {
    await this.#registry.deregister({
      projectId,
      instanceId: instance.instanceId,
      agentIds: [agentId],
    });
  }
}

function throwIfAborted(signal: AgentCallSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal: AgentCallSignal | undefined): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error("The relay request was aborted");
  error.name = "AbortError";
  return error;
}

function sleep(ms: number, signal?: AgentCallSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
