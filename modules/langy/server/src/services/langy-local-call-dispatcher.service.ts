/**
 * One local tool call (ADR-129 "Transport"): worker polls Redis for the
 * result; the socket (maybe another pod) is nudged over pub/sub. States:
 * pending -> running -> [awaiting_permission -> running ->] done (terminal).
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import { LANGY_LIVENESS } from "../rules/langy-streaming-constants.rules.ts";
import { callActivityLine } from "../rules/langy-local-call-activity.rules.ts";
import type { LangyTokenBuffer } from "../repositories/langy-token-buffer.repository.ts";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import {
  CALL_ENVELOPE_SLACK_MS,
  CALL_OFFLINE_WAIT_MS,
  CALL_POLL_HOLD_MS,
  CALL_RESULT_TTL_MS,
  LIVE_STREAM_KEEPALIVE_MS,
  PERMISSION_WAIT_BUDGET_MS,
  POLL_INTERVAL_MS,
} from "@langwatch/langy-contract";
import { LangyLocalWorkspaceOfflineError } from "@langwatch/langy-contract";
import { type CallState, type PollCallResponse } from "@langwatch/langy-contract";
import {
  callKeepaliveKey,
  callKey,
  pendingCallsKey,
  workspaceChannel,
} from "../rules/langy-local-control-keys.rules.ts";
import type { LangyLocalPresence } from "../repositories/langy-local-presence.repository.ts";
import { type CallEnvelope, type LocalToolCall, type ResultFrame } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";

import {
  storedLocalCallSchema,
  type LocalCallBuffer,
  type LocalCallDispatcherOptions,
  type StoredLocalCall,
  type WorkspaceNudge,
} from "../rules/langy-local-call-record.rules.ts";

const logger = createLogger("langwatch:langy:local-control:dispatcher");
export class LocalCallDispatcherService {
  private readonly store: SessionStateStore;
  private readonly presence: LangyLocalPresence;
  private readonly buffer: LocalCallBuffer | null;
  private readonly offlineWaitMs: number;
  private readonly pollIntervalMs: number;
  readonly now: () => number;

  static create(options: LocalCallDispatcherOptions): LocalCallDispatcherService {
    return new LocalCallDispatcherService(options);
  }

  private constructor(options: LocalCallDispatcherOptions) {
    this.store = options.store;
    this.presence = options.presence;
    this.buffer = options.buffer ?? null;
    this.now = options.now ?? (() => nowInstant().epochMilliseconds);
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
      timeoutMs,
      ...call,
    } as StoredLocalCall;

    await this.write(stored);
    await this.track(stored);
    await this.store.publish(
      workspaceChannel(conversationId),
      JSON.stringify({ call: stored.callId } satisfies WorkspaceNudge),
    );

    return stored;
  }

  /**
   * Waits for the call to leave `pending`/`running`, up to the hold. Also
   * refreshes turn liveness here rather than on a timer, so a dead worker's
   * turn ends once it stops polling.
   */
  async tryPoll({
    callId,
    holdMs = CALL_POLL_HOLD_MS,
    signal,
  }: {
    callId: string;
    holdMs?: number;
    signal?: AbortSignal;
  }): Promise<PollCallResponse | null> {
    const until = this.now() + holdMs;
    const beat = this.beater();
    for (;;) {
      const call = await this.tryRead(callId);
      if (!call) {
        return null;
      }

      if (call.state === "done") {
        return toPollResponse(call);
      }

      await beat(call);
      if (this.now() >= until || signal?.aborted) {
        return toPollResponse(call);
      }

      await sleep(this.pollIntervalMs, signal);
    }
  }

  /**
   * The keepalive gate of one poll request: it refreshes on the first pass,
   * then once per heartbeat interval for as long as the request holds.
   */
  private beater(): (call: StoredLocalCall) => Promise<void> {
    let lastBeatAt: number | null = null;

    return async (call) => {
      const now = this.now();
      const due = lastBeatAt === null || now - lastBeatAt >= LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS;
      if (!due) {
        return;
      }

      lastBeatAt = now;
      await this.keepTurnAlive(call);
    };
  }

  /**
   * Holds the turn open, and says on the panel what the machine is doing, at
   * most once per window. Gated on its own key, not the call record — two
   * replicas polling one call must not each write a line.
   */
  private async keepTurnAlive(call: StoredLocalCall): Promise<void> {
    const buffer = this.buffer;
    if (!buffer) {
      return;
    }

    await buffer.heartbeat({
      conversationId: call.conversationId,
      turnId: call.turnId,
      now: this.now(),
    });
    if (this.now() - call.createdAt < LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS) {
      return;
    }

    const firstOfWindow = await this.store.setIfAbsent(
      callKeepaliveKey(call.callId),
      String(this.now()),
      Math.ceil(LIVE_STREAM_KEEPALIVE_MS / 1000),
    );
    if (!firstOfWindow) {
      return;
    }

    const workspace = await this.presence.read(call.conversationId);
    await buffer.appendStatus({
      conversationId: call.conversationId,
      turnId: call.turnId,
      status: callActivityLine({
        call,
        machine: workspace?.hostname ?? "your machine",
      }),
    });
  }

  /** The command line started the call. */
  async ack(callId: string): Promise<void> {
    const call = await this.tryRead(callId);
    if (call?.state !== "pending") {
      return;
    }

    await this.write({ ...call, state: "running" });
  }

  /**
   * The command line needs the developer's answer first. Returns the call as
   * it now stands so the caller can raise the card against it. The envelope
   * now has to outlive the CARD's wait budget, not the command's own deadline.
   */
  async tryAwaitPermission({
    callId,
    waitId,
  }: {
    callId: string;
    waitId: string;
  }): Promise<StoredLocalCall | null> {
    const call = await this.tryRead(callId);
    if (!call || call.state === "done") {
      return null;
    }

    const next: StoredLocalCall = {
      ...call,
      state: "awaiting_permission",
      waitId,
    };
    await this.write(next);
    await this.track(next);

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
    const call = await this.tryRead(callId);
    if (call && call.state === "awaiting_permission") {
      // The command starts now, so its time limit starts now. Counting the
      // minutes the developer spent reading the card against the command left
      // a long ask with a deadline already behind it.
      const released: StoredLocalCall = {
        ...call,
        state: "running",
        deadlineAt: this.now() + (call.timeoutMs ?? call.deadlineAt - call.createdAt),
      };
      await this.write(released);
      await this.track(released);
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
    const call = await this.tryRead(callId);
    if (!call || call.state === "done") {
      return;
    }

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
  async tryCancel({
    callId,
    code = "cancelled",
    message = "The turn was stopped, so the command did not finish.",
  }: {
    callId: string;
    code?: "cancelled" | "timeout" | "permission_expired" | "exec_failed";
    message?: string;
  }): Promise<StoredLocalCall | null> {
    const call = await this.tryRead(callId);
    if (!call || call.state === "done") {
      return null;
    }

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
  async listPendingForConversation(conversationId: string): Promise<StoredLocalCall[]> {
    const ids = await this.store.zrangebyscore(pendingCallsKey(conversationId), 0);
    const calls: StoredLocalCall[] = [];
    for (const id of ids) {
      const call = await this.tryRead(id);
      if (call && call.state !== "done") {
        calls.push(call);
      }
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
    const ids = await this.store.zrangebyscore(pendingCallsKey(conversationId), now);
    const envelopes: CallEnvelope[] = [];
    for (const id of ids) {
      const call = await this.tryRead(id);
      if (call && call.state !== "done") {
        envelopes.push(toEnvelope(call));
      }
    }

    return envelopes;
  }

  async tryRead(callId: string): Promise<StoredLocalCall | null> {
    const raw = await this.store.tryGet(callKey(callId));
    if (!raw) {
      return null;
    }

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
      if (workspace) {
        return;
      }

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
    await this.store.set(callKey(call.callId), JSON.stringify(call), this.envelopeTtlSeconds(call));
  }

  /** Keeps the conversation's pending set in step with the call's own expiry. */
  private async track(call: StoredLocalCall): Promise<void> {
    await this.store.zadd({
      key: pendingCallsKey(call.conversationId),
      score: this.expiresAt(call),
      member: call.callId,
      ttlSeconds: this.envelopeTtlSeconds(call),
    });
  }

  /**
   * When the envelope stops being worth keeping. A call waiting on a card
   * lives for the card's whole budget: the developer has that long to answer,
   * and the call has to be there when they do.
   */
  private expiresAt(call: StoredLocalCall): number {
    if (call.state !== "awaiting_permission") {
      return call.deadlineAt;
    }

    return Math.max(call.deadlineAt, this.now() + PERMISSION_WAIT_BUDGET_MS);
  }

  private envelopeTtlSeconds(call: StoredLocalCall): number {
    const remaining = this.expiresAt(call) - this.now() + CALL_ENVELOPE_SLACK_MS;

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
