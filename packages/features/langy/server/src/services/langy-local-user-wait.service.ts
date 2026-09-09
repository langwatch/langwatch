/**
 * The user wait: one primitive behind the permission and question cards
 * (ADR-129). Durable `user_wait_started` is the card; answer/expiry/Stop
 * share one terminal.
 */

import type { LangyPermissionAnswerSource } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import { LANGY_LIVENESS } from "../rules/langy-streaming-constants.rules.ts";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import type { LangyTokenBufferPort } from "../ports/langy-token-buffer.port.ts";
import {
  CALL_POLL_HOLD_MS,
  LIVE_STREAM_KEEPALIVE_MS,
  PERMISSION_WAIT_BUDGET_MS,
  POLL_INTERVAL_MS,
  QUESTION_WAIT_BUDGET_MS,
} from "@langwatch/langy-contract";
import { LangyWaitExpiredError } from "@langwatch/langy-contract";
import type { PollWaitResponse } from "@langwatch/langy-contract";
import { turnWaitsKey, waitKey } from "../rules/langy-local-control-keys.rules.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:langy:local-control:waits");
import {
  blankUserWait,
  given,
  refuseSettled,
  sleep,
  storedUserWaitSchema,
  toPollResponse,
  type StoredUserWait,
  type UserWaitBuffer,
  type UserWaitEvents,
  type UserWaitQuestion,
  type UserWaitServiceOptions,
} from "../rules/langy-local-user-wait-record.rules.ts";

export class UserWaitService {
  private readonly store: SessionStateStore;
  private readonly events: UserWaitEvents;
  private readonly buffer: UserWaitBuffer;
  private readonly sendPermission: NonNullable<UserWaitServiceOptions["sendPermission"]>;
  private readonly pollIntervalMs: number;
  private readonly keepaliveMs: number;
  readonly now: () => number;

  static create(options: UserWaitServiceOptions): UserWaitService {
    return new UserWaitService(options);
  }

  private constructor(options: UserWaitServiceOptions) {
    this.store = options.store;
    this.events = options.events;
    this.buffer = options.buffer;
    this.sendPermission = options.sendPermission ?? (async () => undefined);
    this.now = options.now ?? (() => nowInstant().epochMilliseconds);
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.keepaliveMs = options.keepaliveMs ?? LIVE_STREAM_KEEPALIVE_MS;
  }

  /** Raises a permission card for one local command. */
  async startPermission(params: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId?: string;
    callId: string;
    summary: string;
    pattern: string;
    patterns: string[];
    reason: string;
    timeoutSeconds?: number;
    skipOffered: boolean;
    workspaceName: string;
    hostname: string;
  }): Promise<StoredUserWait> {
    const wait = blankUserWait({
      now: this.now(),
      ...params,
      kind: "permission",
      budgetMs: PERMISSION_WAIT_BUDGET_MS,
    });
    await this.persist(wait);
    // The live entry first, so the card is on screen while the event store
    // catches up. Same order as `end` below, and for the same reason.
    await this.publishPermission(wait);
    await this.events.startUserWait({
      tenantId: wait.projectId,
      occurredAt: wait.createdAt,
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      waitId: wait.waitId,
      kind: "permission",
      ...(wait.toolCallId ? { toolCallId: wait.toolCallId } : {}),
      expiresAt: wait.expiresAt,
      permission: {
        callId: params.callId,
        summary: params.summary,
        pattern: params.pattern,
        patterns: params.patterns,
        reason: params.reason,
        ...(params.timeoutSeconds === undefined ? {} : { timeoutSeconds: params.timeoutSeconds }),
        skipOffered: params.skipOffered,
        workspaceName: params.workspaceName,
        hostname: params.hostname,
      },
    });

    return wait;
  }

  /** Raises a question card for the worker's `question` tool. */
  async startQuestion(params: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId?: string;
    questions: UserWaitQuestion[];
  }): Promise<StoredUserWait> {
    const wait = blankUserWait({
      now: this.now(),
      ...params,
      kind: "question",
      budgetMs: QUESTION_WAIT_BUDGET_MS,
    });
    await this.persist(wait);
    await this.publishQuestion(wait);
    await this.events.startUserWait({
      tenantId: wait.projectId,
      occurredAt: wait.createdAt,
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      waitId: wait.waitId,
      kind: "question",
      ...(wait.toolCallId ? { toolCallId: wait.toolCallId } : {}),
      expiresAt: wait.expiresAt,
      questions: params.questions,
    });

    return wait;
  }

  /**
   * Holds until the card is answered, expires, or the hold runs out. Every
   * pass refreshes the live stream when the keepalive interval has gone by, so
   * a turn that waits ten minutes is still readable on a reload.
   */
  async tryPoll({
    waitId,
    holdMs = CALL_POLL_HOLD_MS,
    signal,
  }: {
    waitId: string;
    holdMs?: number;
    signal?: AbortSignal;
  }): Promise<PollWaitResponse | null> {
    const until = this.now() + holdMs;
    const beat = this.beater();
    for (;;) {
      const wait = await this.readSettlingExpiry(waitId);
      if (!wait) {
        return null;
      }

      if (wait.state !== "pending") {
        return toPollResponse(wait);
      }

      await beat(wait);
      await this.keepAlive(wait);
      if (this.now() >= until || signal?.aborted) {
        return toPollResponse(wait);
      }

      await sleep(this.pollIntervalMs, signal);
    }
  }

  /**
   * The liveness gate of one poll request: it refreshes on the first pass,
   * then once per heartbeat interval for as long as the request holds. The
   * request is the worker's own, so a worker that stopped stops refreshing.
   */
  private beater(): (wait: StoredUserWait) => Promise<void> {
    let lastBeatAt: number | null = null;

    return async (wait) => {
      const now = this.now();
      const due = lastBeatAt === null || now - lastBeatAt >= LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS;
      if (!due) {
        return;
      }

      lastBeatAt = now;
      await this.buffer.heartbeat({
        conversationId: wait.conversationId,
        turnId: wait.turnId,
        now,
      });
    };
  }

  /**
   * The developer answered, on the card or in the terminal. First answer wins.
   * @throws {LangyWaitExpiredError} not waiting any more; panel falls back to
   * sending the answer as the next message
   */
  async answer({
    waitId,
    userId,
    decision,
    answers,
    source = "panel",
    patterns,
  }: {
    waitId: string;
    userId: string;
    decision?: "allow_once" | "allow_pattern" | "deny";
    answers?: Array<{ question: string; selected: string[]; other?: string }>;
    /** Where the answer was given. The card in the panel unless said otherwise. */
    source?: LangyPermissionAnswerSource;
    /** What a terminal grant covers, when the terminal named it. */
    patterns?: string[];
  }): Promise<StoredUserWait> {
    const wait = await this.readSettlingExpiry(waitId);
    if (wait?.state !== "pending") {
      refuseSettled({ waitId, wait });
    }

    const answered: StoredUserWait = {
      ...wait,
      state: "answered",
      answeredBy: userId,
      source,
      ...given({
        decision,
        answers,
        patterns: patterns?.length ? patterns : undefined,
      }),
    };
    await this.persist(answered);
    await this.end(answered, "answered");
    if (answered.kind === "permission" && answered.callId) {
      await this.sendPermission({
        conversationId: answered.conversationId,
        callId: answered.callId,
        decision: decision ?? "deny",
      });
    }

    return answered;
  }

  /**
   * Ends every card still waiting on one turn. The turn's Stop path and the
   * worker's own cancel both call this, so it has to be idempotent.
   */
  async cancelTurn({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<StoredUserWait[]> {
    const cancelled: StoredUserWait[] = [];
    for (const wait of await this.listPending({ conversationId, turnId })) {
      const next: StoredUserWait = { ...wait, state: "cancelled" };
      await this.persist(next);
      await this.end(next, "cancelled");
      if (next.kind === "permission" && next.callId) {
        await this.sendPermission({
          conversationId: next.conversationId,
          callId: next.callId,
          decision: "expired",
        });
      }

      cancelled.push(next);
    }

    return cancelled;
  }

  /** Every card still waiting on one turn. */
  async listPending({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<StoredUserWait[]> {
    const ids = await this.store.zrangebyscore(turnWaitsKey(conversationId, turnId), 0);
    const pending: StoredUserWait[] = [];
    for (const id of ids) {
      const wait = await this.tryRead(id);
      if (wait?.state === "pending") {
        pending.push(wait);
      }
    }

    return pending;
  }

  async tryRead(waitId: string): Promise<StoredUserWait | null> {
    const raw = await this.store.tryGet(waitKey(waitId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = storedUserWaitSchema.safeParse(JSON.parse(raw));

      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** The wait, with its budget applied: a card past its time reads expired. */
  private async readSettlingExpiry(waitId: string): Promise<StoredUserWait | null> {
    const wait = await this.tryRead(waitId);
    if (!wait) {
      return null;
    }

    if (wait.state !== "pending" || wait.expiresAt > this.now()) {
      return wait;
    }

    const expired: StoredUserWait = { ...wait, state: "expired" };
    await this.persist(expired);
    await this.end(expired, "expired");
    if (expired.kind === "permission" && expired.callId) {
      await this.sendPermission({
        conversationId: expired.conversationId,
        callId: expired.callId,
        decision: "expired",
      });
    }

    logger.info({ waitId, kind: expired.kind }, "user wait passed its budget with no answer");

    return expired;
  }

  /**
   * Locks the card on the live edge, then writes the terminal event. Order
   * matters: a terminal-given answer reaches the panel only via the live
   * entry, so writing it first avoids the card lagging the event store.
   */
  private async end(
    wait: StoredUserWait,
    outcome: "answered" | "expired" | "cancelled",
  ): Promise<void> {
    if (wait.kind === "permission") {
      await this.publishPermission(wait);
    } else {
      await this.publishQuestion(wait);
    }

    await this.events.endUserWait({
      tenantId: wait.projectId,
      occurredAt: this.now(),
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      waitId: wait.waitId,
      kind: wait.kind,
      ...(wait.toolCallId ? { toolCallId: wait.toolCallId } : {}),
      outcome,
      ...(wait.answeredBy ? { userId: wait.answeredBy } : {}),
      ...(wait.decision ? { decision: wait.decision } : {}),
      ...(wait.source ? { source: wait.source } : {}),
      ...(wait.answers
        ? {
            answers: wait.answers as Array<{
              question: string;
              selected: string[];
              other?: string;
            }>,
          }
        : {}),
    });
    await this.store.zrem(turnWaitsKey(wait.conversationId, wait.turnId), wait.waitId);
  }

  /**
   * One `status` entry when the keepalive interval has passed. It renders
   * behind the tool card that is already on screen, so its only job is to push
   * the live stream's expiry back out to a full window.
   */
  private async keepAlive(wait: StoredUserWait): Promise<void> {
    const now = this.now();
    if (now - wait.lastKeepaliveAt < this.keepaliveMs) {
      return;
    }

    await this.persist({ ...wait, lastKeepaliveAt: now });
    await this.buffer.appendStatus({
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      status:
        wait.kind === "permission"
          ? "Waiting for your answer on the permission card"
          : "Waiting for your answer",
    });
  }

  private async publishPermission(wait: StoredUserWait): Promise<void> {
    if (!wait.callId) {
      return;
    }

    await this.buffer.appendLocalPermission({
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      entry: {
        waitId: wait.waitId,
        callId: wait.callId,
        summary: wait.summary ?? "",
        pattern: wait.pattern ?? "",
        patterns: wait.patterns ?? [],
        reason: wait.reason ?? "",
        skipOffered: wait.skipOffered ?? false,
        workspaceName: wait.workspaceName ?? "",
        hostname: wait.hostname ?? "",
        status: wait.state,
        ...given({
          toolCallId: wait.toolCallId,
          timeoutSeconds: wait.timeoutSeconds,
          decision: wait.decision,
          source: wait.source,
        }),
      },
    });
  }

  private async publishQuestion(wait: StoredUserWait): Promise<void> {
    await this.buffer.appendQuestion({
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      entry: {
        waitId: wait.waitId,
        ...(wait.toolCallId ? { toolCallId: wait.toolCallId } : {}),
        questions: wait.questions ?? [],
        status: wait.state,
        ...(wait.answers !== undefined ? { answers: wait.answers } : {}),
      },
    });
  }

  private async persist(wait: StoredUserWait): Promise<void> {
    // The record outlives its budget so a late answer can be told the card is
    // over, rather than that it never existed.
    const ttlSeconds = Math.max(60, Math.ceil((wait.expiresAt - this.now()) / 1000) + 300);
    await this.store.set(waitKey(wait.waitId), JSON.stringify(wait), ttlSeconds);
    if (wait.state === "pending") {
      await this.store.zadd({
        key: turnWaitsKey(wait.conversationId, wait.turnId),
        score: wait.expiresAt,
        member: wait.waitId,
        ttlSeconds,
      });
    }
  }
}
