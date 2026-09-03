/**
 * One local tool call, from the worker's request to the answer the command
 * line sends back (ADR-129, "Transport").
 *
 * The worker starts a call with one HTTP request and long-polls the result.
 * The command line's socket may be held by another pod, so the envelope, the
 * state and the result all live in Redis and the socket's pod is nudged over
 * pub/sub. The worker never subscribes to anything: it polls the state key,
 * which is what makes its side survive a pod it never talked to.
 *
 * The state machine is
 *
 *   pending -> running -> done                     the ordinary call
 *   pending -> running -> awaiting_permission -> running -> done
 *                                                  a command that had to ask
 *   pending|running|awaiting_permission -> done    cancelled, or the folder left
 *
 * `done` is terminal and written once. Everything that can end a call, the
 * command line's result, the turn's Stop, an expired permission card, contends
 * for that one transition, so a call cannot answer twice.
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AgentStateStore } from "~/server/connected-agents/state-store";
import {
  CALL_ENVELOPE_SLACK_MS,
  CALL_OFFLINE_WAIT_MS,
  CALL_POLL_HOLD_MS,
  CALL_RESULT_TTL_MS,
  POLL_INTERVAL_MS,
} from "./constants";
import { LangyLocalWorkspaceOfflineError } from "./errors";
import { CALL_STATES, type CallState, type PollCallResponse } from "./http";
import { callKey, pendingCallsKey, workspaceChannel } from "./keys";
import type { LocalWorkspacePresence } from "./presence";
import {
  bashOutputSchema,
  type CallEnvelope,
  type LocalToolCall,
  localCallErrorSchema,
  localToolCallSchema,
  type ResultFrame,
} from "./protocol";

const logger = createLogger("langwatch:langy:local-control:dispatcher");

/** What the platform keeps about one call while it is in flight. */
export const storedLocalCallSchema = z
  .object({
    callId: z.string(),
    projectId: z.string(),
    conversationId: z.string(),
    turnId: z.string(),
    /** The worker's own tool call, so the card renders where the work is. */
    toolCallId: z.string().optional(),
    state: z.enum(CALL_STATES),
    createdAt: z.number(),
    deadlineAt: z.number(),
    /** The permission card this call is waiting on, while it waits. */
    waitId: z.string().optional(),
    ok: z.boolean().optional(),
    text: z.string().optional(),
    output: bashOutputSchema.optional(),
    error: localCallErrorSchema.optional(),
  })
  .and(localToolCallSchema);
export type StoredLocalCall = z.infer<typeof storedLocalCallSchema>;

/** What one pod tells another about a conversation's folder. */
export const workspaceNudgeSchema = z.union([
  z.object({ call: z.string() }),
  z.object({ cancel: z.string() }),
  z.object({
    permission: z.object({
      callId: z.string(),
      decision: z.enum(["allow_once", "allow_pattern", "deny", "expired"]),
    }),
  }),
  z.object({ policy: z.object({ skipPermissions: z.boolean() }) }),
  z.object({ disconnect: z.object({ reason: z.string() }) }),
]);
export type WorkspaceNudge = z.infer<typeof workspaceNudgeSchema>;

export interface LocalCallDispatcherOptions {
  store: AgentStateStore;
  presence: LocalWorkspacePresence;
  now?: () => number;
  /** Test knob: how long a first call waits for the folder to appear. */
  offlineWaitMs?: number;
  pollIntervalMs?: number;
}

export class LocalCallDispatcher {
  private readonly store: AgentStateStore;
  private readonly presence: LocalWorkspacePresence;
  private readonly offlineWaitMs: number;
  private readonly pollIntervalMs: number;
  readonly now: () => number;

  constructor(options: LocalCallDispatcherOptions) {
    this.store = options.store;
    this.presence = options.presence;
    this.now = options.now ?? (() => Date.now());
    this.offlineWaitMs = options.offlineWaitMs ?? CALL_OFFLINE_WAIT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  }

  /**
   * Places one call on the conversation's folder.
   *
   * @throws {LangyLocalWorkspaceOfflineError} no folder answered in time
   */
  async start({
    projectId,
    conversationId,
    turnId,
    toolCallId,
    call,
    timeoutMs,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId?: string;
    call: LocalToolCall;
    timeoutMs: number;
  }): Promise<StoredLocalCall> {
    await this.requireWorkspace(conversationId);

    const createdAt = this.now();
    const stored = {
      callId: `lcall_${nanoid()}`,
      projectId,
      conversationId,
      turnId,
      ...(toolCallId ? { toolCallId } : {}),
      state: "pending" as CallState,
      createdAt,
      deadlineAt: createdAt + timeoutMs,
      ...call,
    } as StoredLocalCall;

    await this.write(stored);
    await this.store.zadd({
      key: pendingCallsKey(conversationId),
      score: stored.deadlineAt,
      member: stored.callId,
      ttlSeconds: this.envelopeTtlSeconds(stored),
    });
    await this.store.publish(
      workspaceChannel(conversationId),
      JSON.stringify({ call: stored.callId } satisfies WorkspaceNudge),
    );
    return stored;
  }

  /**
   * Waits for the call to leave `pending`/`running`, up to the hold, then
   * answers with whatever state it is in. A worker that gets a non-terminal
   * answer simply asks again, so a hold that ends early costs one request.
   */
  async poll({
    callId,
    holdMs = CALL_POLL_HOLD_MS,
    signal,
  }: {
    callId: string;
    holdMs?: number;
    signal?: AbortSignal;
  }): Promise<PollCallResponse | null> {
    const until = this.now() + holdMs;
    for (;;) {
      const call = await this.read(callId);
      if (!call) return null;
      if (call.state === "done") return toPollResponse(call);
      if (this.now() >= until || signal?.aborted) return toPollResponse(call);
      await sleep(this.pollIntervalMs, signal);
    }
  }

  /** The command line started the call. */
  async ack(callId: string): Promise<void> {
    const call = await this.read(callId);
    if (call?.state !== "pending") return;
    await this.write({ ...call, state: "running" });
  }

  /**
   * The command line needs the developer's answer first. Returns the call as
   * it now stands so the caller can raise the card against it.
   */
  async awaitPermission({
    callId,
    waitId,
  }: {
    callId: string;
    waitId: string;
  }): Promise<StoredLocalCall | null> {
    const call = await this.read(callId);
    if (!call || call.state === "done") return null;
    const next: StoredLocalCall = {
      ...call,
      state: "awaiting_permission",
      waitId,
    };
    await this.write(next);
    return next;
  }

  /** Sends the developer's answer to the command line holding the call. */
  async sendPermission({
    conversationId,
    callId,
    decision,
  }: {
    conversationId: string;
    callId: string;
    decision: "allow_once" | "allow_pattern" | "deny" | "expired";
  }): Promise<void> {
    const call = await this.read(callId);
    if (call && call.state === "awaiting_permission") {
      await this.write({ ...call, state: "running" });
    }
    await this.store.publish(
      workspaceChannel(conversationId),
      JSON.stringify({
        permission: { callId, decision },
      } satisfies WorkspaceNudge),
    );
  }

  /** The command line answered. First terminal wins. */
  async result({
    callId,
    frame,
  }: {
    callId: string;
    frame: Pick<ResultFrame, "ok" | "text" | "output" | "error">;
  }): Promise<void> {
    const call = await this.read(callId);
    if (!call || call.state === "done") return;
    await this.settle({
      ...call,
      ok: frame.ok,
      ...(frame.text !== undefined ? { text: frame.text } : {}),
      ...(frame.output !== undefined ? { output: frame.output } : {}),
      ...(frame.error !== undefined ? { error: frame.error } : {}),
    });
  }

  /**
   * Ends the call without the command line's answer: the turn was stopped, the
   * folder left, or the permission card expired. Idempotent, because the turn
   * cancel path and the worker's own cancel both reach here.
   */
  async cancel({
    callId,
    code = "cancelled",
    message = "The turn was stopped, so the command did not finish.",
  }: {
    callId: string;
    code?: "cancelled" | "timeout" | "permission_expired" | "exec_failed";
    message?: string;
  }): Promise<StoredLocalCall | null> {
    const call = await this.read(callId);
    if (!call || call.state === "done") return null;
    await this.store.publish(
      workspaceChannel(call.conversationId),
      JSON.stringify({ cancel: callId } satisfies WorkspaceNudge),
    );
    return this.settle({ ...call, ok: false, error: { code, message } });
  }

  /** Every call still in flight on one turn, for the Stop path. */
  async listPendingForTurn({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<StoredLocalCall[]> {
    const calls = await this.listPendingForConversation(conversationId);
    return calls.filter((call) => call.turnId === turnId);
  }

  /** Every call still in flight on one folder, for the disconnect path. */
  async listPendingForConversation(
    conversationId: string,
  ): Promise<StoredLocalCall[]> {
    const ids = await this.store.zrangebyscore(
      pendingCallsKey(conversationId),
      0,
    );
    const calls: StoredLocalCall[] = [];
    for (const id of ids) {
      const call = await this.read(id);
      if (call && call.state !== "done") calls.push(call);
    }
    return calls;
  }

  /**
   * The calls a folder should receive the moment it registers: the ones
   * written while its socket was reconnecting.
   */
  async pendingEnvelopes(conversationId: string): Promise<CallEnvelope[]> {
    const now = this.now();
    await this.store.zremrangebyscore(pendingCallsKey(conversationId), now);
    const ids = await this.store.zrangebyscore(
      pendingCallsKey(conversationId),
      now,
    );
    const envelopes: CallEnvelope[] = [];
    for (const id of ids) {
      const call = await this.read(id);
      if (call && call.state !== "done") envelopes.push(toEnvelope(call));
    }
    return envelopes;
  }

  async read(callId: string): Promise<StoredLocalCall | null> {
    const raw = await this.store.get(callKey(callId));
    if (!raw) return null;
    try {
      const parsed = storedLocalCallSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** The call as the command line receives it. */
  envelopeOf(call: StoredLocalCall): CallEnvelope {
    return toEnvelope(call);
  }

  /**
   * Refuses when no folder is connected, after a short wait: the first call of
   * a turn can land while the developer is still approving in the terminal.
   */
  private async requireWorkspace(conversationId: string): Promise<void> {
    const until = this.now() + this.offlineWaitMs;
    for (;;) {
      const workspace = await this.presence.read(conversationId);
      if (workspace) return;
      if (this.now() >= until) {
        logger.info({ conversationId }, "no local folder answered the call");
        throw new LangyLocalWorkspaceOfflineError({ conversationId });
      }
      await sleep(this.pollIntervalMs);
    }
  }

  private async settle(call: StoredLocalCall): Promise<StoredLocalCall> {
    const done: StoredLocalCall = { ...call, state: "done" };
    await this.store.set(
      callKey(done.callId),
      JSON.stringify(done),
      Math.ceil(CALL_RESULT_TTL_MS / 1000),
    );
    await this.store.zrem(pendingCallsKey(done.conversationId), done.callId);
    return done;
  }

  private async write(call: StoredLocalCall): Promise<void> {
    await this.store.set(
      callKey(call.callId),
      JSON.stringify(call),
      this.envelopeTtlSeconds(call),
    );
  }

  private envelopeTtlSeconds(call: StoredLocalCall): number {
    const remaining = call.deadlineAt - this.now() + CALL_ENVELOPE_SLACK_MS;
    return Math.max(1, Math.ceil(remaining / 1000));
  }
}

function toEnvelope(call: StoredLocalCall): CallEnvelope {
  return {
    callId: call.callId,
    conversationId: call.conversationId,
    turnId: call.turnId,
    deadlineAt: call.deadlineAt,
    tool: call.tool,
    params: call.params,
  } as CallEnvelope;
}

function toPollResponse(call: StoredLocalCall): PollCallResponse {
  return {
    callId: call.callId,
    state: call.state,
    ...(call.ok !== undefined ? { ok: call.ok } : {}),
    ...(call.text !== undefined ? { text: call.text } : {}),
    ...(call.output !== undefined ? { output: call.output } : {}),
    ...(call.error !== undefined ? { error: call.error } : {}),
  };
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
