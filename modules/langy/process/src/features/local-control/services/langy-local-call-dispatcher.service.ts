/**
 * One local tool call (ADR-129 "Transport"): worker polls Redis for the
 * result; the socket (maybe another pod) is nudged over pub/sub. States:
 * pending -> running -> [awaiting_permission -> running ->] done (terminal).
 */

import { setTimeout as sleep } from "node:timers/promises";

import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import {
  CALL_ENVELOPE_SLACK_MS,
  CALL_OFFLINE_WAIT_MS,
  CALL_POLL_HOLD_MS,
  CALL_RESULT_TTL_MS,
  PERMISSION_WAIT_BUDGET_MS,
  POLL_INTERVAL_MS,
  LangyLocalRecordUnreadableError,
  LangyLocalWorkspaceOfflineError,
} from "@langwatch/langy-contract";
import {
  type CallState,
  type PollCallResponse,
  type CallEnvelope,
  type LocalToolCall,
  type ResultFrame,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { LangyLocalWorkspaceChannel } from "../../../channels/langy-local-workspace.channel.ts";
import { LANGY_ID_RESOURCES } from "../../../eventing/langy-conversation-process.schemas.ts";
import type { LangyLocalCallRepository } from "../../../repositories/langy-local-call.repository.ts";
import type { LangyLocalPresenceRepository } from "../../../repositories/langy-local-presence.repository.ts";
import type {
  LocalCallBuffer,
  StoredLocalCall,
} from "../../../rules/langy-local-call-record.rules.ts";
import { LocalCallKeepaliveService } from "./langy-local-call-keepalive.service.ts";

const logger = createLogger("langwatch:langy:local-control:dispatcher");

/** One poll of a call, or `gone` once its record has expired. */
type LocalCallPoll = { outcome: "polled"; answer: PollCallResponse } | { outcome: "gone" };
export type LocalCallLookup = { kind: "hit"; call: StoredLocalCall } | { kind: "miss" };

interface LocalCallDispatcherOptions {
  calls: LangyLocalCallRepository;
  workspace: LangyLocalWorkspaceChannel;
  presence: LangyLocalPresenceRepository;
  buffer?: LocalCallBuffer;
  now?: () => number;
  /** Test knob: how long a first call waits for the folder to appear. */
  offlineWaitMs?: number;
  pollIntervalMs?: number;
}

export class LocalCallDispatcherService {
  private readonly calls: LangyLocalCallRepository;
  private readonly workspace: LangyLocalWorkspaceChannel;
  private readonly presence: LangyLocalPresenceRepository;
  private readonly buffer: LocalCallBuffer | null;
  private readonly offlineWaitMs: number;
  private readonly pollIntervalMs: number;
  private readonly keepalive: LocalCallKeepaliveService;
  readonly now: () => number;

  static create(options: LocalCallDispatcherOptions): LocalCallDispatcherService {
    return new LocalCallDispatcherService(options);
  }

  private constructor(options: LocalCallDispatcherOptions) {
    this.calls = options.calls;
    this.workspace = options.workspace;
    this.presence = options.presence;
    this.buffer = options.buffer ?? null;
    this.now = options.now ?? (() => nowInstant().epochMilliseconds);
    this.offlineWaitMs = options.offlineWaitMs ?? CALL_OFFLINE_WAIT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.keepalive = LocalCallKeepaliveService.create({
      calls: this.calls,
      presence: this.presence,
      buffer: this.buffer,
      now: this.now,
    });
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
    // A turn that reaches the folder is the turn the connect message was for,
    // so the folder is owed no turn of its own.
    await this.presence.settleOwedConnectTurn(conversationId);

    const createdAt = this.now();
    const stored = {
      callId: generate(LANGY_ID_RESOURCES.call).toString(),
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
    await this.workspace.nudge({ conversationId, nudge: { call: stored.callId } });

    return stored;
  }

  /**
   * Waits for the call to leave `pending`/`running`, up to the hold. Also
   * refreshes turn liveness here rather than on a timer, so a dead worker's
   * turn ends once it stops polling.
   */
  async poll({
    callId,
    holdMs = CALL_POLL_HOLD_MS,
    signal,
  }: {
    callId: string;
    holdMs?: number;
    signal?: AbortSignal;
  }): Promise<LocalCallPoll> {
    const until = this.now() + holdMs;
    const beat = this.keepalive.beater();
    const look = async (): Promise<LocalCallLookup> => {
      const lookup = await this.getCall(callId);
      if (lookup.kind === "hit" && lookup.call.state !== "done") await beat(lookup.call);
      return lookup;
    };
    let lookup = await look();
    while (
      lookup.kind === "hit" &&
      lookup.call.state !== "done" &&
      this.now() < until &&
      !signal?.aborted
    ) {
      await sleep(this.pollIntervalMs, undefined, { signal }).catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) throw error;
      });
      lookup = await look();
    }
    return lookup.kind === "hit"
      ? { outcome: "polled", answer: toPollResponse(lookup.call) }
      : { outcome: "gone" };
  }

  /** The command line started the call. */
  async ack(callId: string): Promise<void> {
    const lookup = await this.getCall(callId);
    if (lookup.kind === "miss" || lookup.call.state !== "pending") {
      return;
    }
    const { call } = lookup;

    await this.write({ ...call, state: "running" });
  }

  /**
   * The command line needs the developer's answer first; a settled or expired
   * call is left alone. The envelope now has to outlive the CARD's wait
   * budget, not the command's own deadline.
   */
  async awaitPermission({ callId, waitId }: { callId: string; waitId: string }): Promise<void> {
    const lookup = await this.getCall(callId);
    if (lookup.kind === "miss" || lookup.call.state === "done") {
      return;
    }
    const { call } = lookup;

    const next: StoredLocalCall = {
      ...call,
      state: "awaiting_permission",
      waitId,
    };
    await this.write(next);
    await this.track(next);
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
    const lookup = await this.getCall(callId);
    if (lookup.kind === "hit" && lookup.call.state === "awaiting_permission") {
      const { call } = lookup;
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

    await this.workspace.nudge({ conversationId, nudge: { permission: { callId, decision } } });
  }

  /** The command line answered. First terminal wins. */
  async result({
    callId,
    frame,
  }: {
    callId: string;
    frame: Pick<ResultFrame, "ok" | "text" | "output" | "error">;
  }): Promise<void> {
    const lookup = await this.getCall(callId);
    if (lookup.kind === "miss" || lookup.call.state === "done") {
      return;
    }
    const { call } = lookup;

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
    message = "the turn was stopped, so the command did not finish.",
  }: {
    callId: string;
    code?: "cancelled" | "timeout" | "permission_expired" | "exec_failed";
    message?: string;
  }): Promise<void> {
    const lookup = await this.getCall(callId);
    if (lookup.kind === "miss" || lookup.call.state === "done") {
      return;
    }
    const { call } = lookup;

    await this.workspace.nudge({ conversationId: call.conversationId, nudge: { cancel: callId } });

    await this.settle({ ...call, ok: false, error: { code, message } });
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
    const ids = await this.calls.findPendingIds({ conversationId, from: 0 });
    const calls: StoredLocalCall[] = [];
    for (const id of ids) {
      const lookup = await this.readSkippingUnreadable(id);
      const call = lookup.kind === "hit" ? lookup.call : undefined;
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
    await this.calls.dropLapsedPending({ conversationId, lapsedAt: now });
    const ids = await this.calls.findPendingIds({ conversationId, from: now });
    const envelopes: CallEnvelope[] = [];
    for (const id of ids) {
      const lookup = await this.readSkippingUnreadable(id);
      const call = lookup.kind === "hit" ? lookup.call : undefined;
      if (call && call.state !== "done") {
        envelopes.push(toEnvelope(call));
      }
    }

    return envelopes;
  }

  /**
   * The stored call; `miss` once its key has expired. A blob we wrote that no
   * longer decodes is corruption rather than absence, so it raises under a code
   * that tells the person at the command line to ask for the change again.
   */
  async getCall(callId: string): Promise<LocalCallLookup> {
    const lookup = await this.calls.find(callId);
    if (lookup.kind === "unreadable") {
      throw new LangyLocalRecordUnreadableError({ reasons: lookup.reasons });
    }

    return lookup.kind === "hit" ? { kind: "hit", call: lookup.value } : { kind: "miss" };
  }

  /** The call as the command line receives it. */
  envelopeOf(call: StoredLocalCall): CallEnvelope {
    return toEnvelope(call);
  }

  /** Marks the call done, kept long enough for its answer to be read, and off the pending set. */
  private async settle(call: StoredLocalCall): Promise<StoredLocalCall> {
    const done: StoredLocalCall = { ...call, state: "done" };
    await this.calls.save({ call: done, ttlSeconds: Math.ceil(CALL_RESULT_TTL_MS / 1000) });
    await this.calls.untrackPending({ conversationId: done.conversationId, callId: done.callId });

    return done;
  }

  private async write(call: StoredLocalCall): Promise<void> {
    await this.calls.save({ call, ttlSeconds: this.envelopeTtlSeconds(call) });
  }

  /** Keeps the conversation's pending set in step with the call's own expiry. */
  private async track(call: StoredLocalCall): Promise<void> {
    await this.calls.trackPending({
      conversationId: call.conversationId,
      callId: call.callId,
      expiresAt: this.expiresAt(call),
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

  /**
   * A list loop's read: skips only the named unreadable error so one corrupt
   * call cannot take the whole listing down; anything else still propagates.
   */
  private async readSkippingUnreadable(callId: string): Promise<LocalCallLookup> {
    try {
      return await this.getCall(callId);
    } catch (error) {
      if (!(error instanceof LangyLocalRecordUnreadableError)) {
        throw error;
      }

      logger.warn({ callId }, "skipping unreadable local call");

      return { kind: "miss" };
    }
  }

  /**
   * Refuses when no folder is connected, after a short wait: the first call of
   * a turn can land while the developer is still approving in the terminal.
   */
  private async requireWorkspace(conversationId: string): Promise<void> {
    const until = this.now() + this.offlineWaitMs;
    while (!(await this.isConnected(conversationId))) {
      if (this.now() >= until) {
        logger.info({ conversationId }, "no local folder answered the call");
        throw new LangyLocalWorkspaceOfflineError({ conversationId });
      }
      await sleep(this.pollIntervalMs);
    }
  }

  private async isConnected(conversationId: string): Promise<boolean> {
    return this.presence.getByConversationId(conversationId).then(
      () => true,
      (error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "langy_local_workspace_offline") {
          return false;
        }
        throw error;
      },
    );
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
