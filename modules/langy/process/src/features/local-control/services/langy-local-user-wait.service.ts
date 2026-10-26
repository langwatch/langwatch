/**
 * The user wait: one primitive behind the permission and question cards
 * (ADR-129). Durable `user_wait_started` is the card; answer/expiry/Stop
 * share one terminal.
 */

import { clearTimeout, setTimeout } from "node:timers";

import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import {
  LangyLocalRecordNotFoundError,
  LangyLocalRecordUnreadableError,
  type LangyPermissionAnswerSource,
  CALL_POLL_HOLD_MS,
  LIVE_STREAM_KEEPALIVE_MS,
  PERMISSION_WAIT_BUDGET_MS,
  POLL_INTERVAL_MS,
  QUESTION_WAIT_BUDGET_MS,
  type PollWaitResponse,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { LANGY_ID_RESOURCES } from "../../../eventing/langy-conversation-process.schemas.ts";
import type { LangyLocalUserWaitRepository } from "../../../repositories/langy-local-user-wait.repository.ts";

const logger = createLogger("langwatch:langy:local-control:waits");
import {
  blankUserWait,
  given,
  refuseSettled,
  toPollResponse,
  type StoredUserWait,
  type UserWaitBuffer,
  type UserWaitConfirm,
  type UserWaitEvents,
  type UserWaitQuestion,
} from "../../../rules/langy-local-user-wait-record.rules.ts";
import { UserWaitCardsService } from "./langy-local-user-wait-cards.service.ts";

interface UserWaitServiceOptions {
  waits: LangyLocalUserWaitRepository;
  events: UserWaitEvents;
  buffer: UserWaitBuffer;
  /**
   * Sends the developer's answer to the folder holding the call. Injected, so
   * the wait service never depends on the transport and a unit test proves the
   * frame was asked for without a socket.
   */
  sendPermission?: (args: {
    conversationId: string;
    callId: string;
    decision: "allow_once" | "allow_pattern" | "deny" | "expired";
  }) => Promise<void>;
  /** Told every card's answer once it is stored, so a confirmation card can record its click. */
  onAnswered?: (wait: StoredUserWait) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  keepaliveMs?: number;
}

/** One poll of a card, or `gone` once its record has expired. */
type UserWaitPoll = { outcome: "polled"; answer: PollWaitResponse } | { outcome: "gone" };
export class UserWaitService {
  private readonly waits: LangyLocalUserWaitRepository;
  private readonly events: UserWaitEvents;
  private readonly cards: UserWaitCardsService;
  private readonly sendPermission: NonNullable<UserWaitServiceOptions["sendPermission"]>;
  private readonly onAnswered: NonNullable<UserWaitServiceOptions["onAnswered"]>;
  private readonly pollIntervalMs: number;
  private readonly keepaliveMs: number;
  readonly now: () => number;

  static create(options: UserWaitServiceOptions): UserWaitService {
    return new UserWaitService(options);
  }

  private constructor(options: UserWaitServiceOptions) {
    this.waits = options.waits;
    this.events = options.events;
    this.sendPermission = options.sendPermission ?? (async () => undefined);
    this.onAnswered = options.onAnswered ?? (async () => undefined);
    this.now = options.now ?? (() => nowInstant().epochMilliseconds);
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.keepaliveMs = options.keepaliveMs ?? LIVE_STREAM_KEEPALIVE_MS;
    this.cards = UserWaitCardsService.create({ buffer: options.buffer, now: this.now });
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
      waitId: generate(LANGY_ID_RESOURCES.wait).toString(),
      now: this.now(),
      ...params,
      kind: "permission",
      budgetMs: PERMISSION_WAIT_BUDGET_MS,
    });
    await this.persist(wait);
    // The live entry first, so the card is on screen while the event store
    // catches up. Same order as `end` below, and for the same reason.
    await this.cards.publishPermission(wait);
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

  /**
   * Raises a question card for the worker's `question` tool, or, with `confirm` and no tool
   * call, a confirmation card the platform asks itself.
   */
  async startQuestion(params: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId?: string;
    questions: UserWaitQuestion[];
    confirm?: UserWaitConfirm;
  }): Promise<StoredUserWait> {
    const wait = blankUserWait({
      waitId: generate(LANGY_ID_RESOURCES.wait).toString(),
      now: this.now(),
      ...params,
      kind: "question",
      budgetMs: QUESTION_WAIT_BUDGET_MS,
    });
    await this.persist(wait);
    await this.cards.publishQuestion(wait);
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
  async poll({
    waitId,
    holdMs = CALL_POLL_HOLD_MS,
    signal,
  }: {
    waitId: string;
    holdMs?: number;
    signal?: AbortSignal;
  }): Promise<UserWaitPoll> {
    const until = this.now() + holdMs;
    const beat = this.cards.beater();
    const look = async (): Promise<StoredUserWait | null> => {
      const wait = await this.readSettlingExpiry(waitId);
      if (wait?.state === "pending") {
        await beat(wait);
        await this.keepAlive(wait);
      }
      return wait;
    };
    let wait = await look();
    while (wait?.state === "pending" && this.now() < until && !signal?.aborted) {
      await sleep(this.pollIntervalMs, signal);
      wait = await look();
    }
    return wait ? { outcome: "polled", answer: toPollResponse(wait) } : { outcome: "gone" };
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
    answers?: { question: string; selected: string[]; other?: string }[];
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
    await this.onAnswered(answered);
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
   * Ends every card still waiting on one turn. The turn's Stop path and the worker's own cancel
   * both call this, so it has to be idempotent. A confirmation card the platform raised is left
   * waiting: its click is read in a later turn, so it stays answerable after this one ends.
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
      if (wait.confirm) continue;
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
    const ids = await this.waits.findPendingIds({ conversationId, turnId });
    const pending: StoredUserWait[] = [];
    for (const id of ids) {
      let wait: StoredUserWait;
      try {
        wait = await this.getWait(id);
      } catch (error) {
        if (HandledError.isHandled(error) && error.code === "langy_local_record_not_found") {
          continue;
        }
        if (!(error instanceof LangyLocalRecordUnreadableError)) {
          throw error;
        }

        logger.warn({ waitId: id }, "skipping unreadable user wait");
        continue;
      }

      if (wait.state === "pending") {
        pending.push(wait);
      }
    }

    return pending;
  }

  /**
   * The stored wait; `langy_local_record_not_found` once its key has expired. A blob
   * we wrote that no longer decodes is corruption rather than absence, so it raises
   * under a code that tells the person at the command line to ask for the change again.
   */
  async getWait(waitId: string): Promise<StoredUserWait> {
    const lookup = await this.waits.find(waitId);
    if (lookup.kind === "miss") {
      throw new LangyLocalRecordNotFoundError();
    }
    if (lookup.kind === "unreadable") {
      throw new LangyLocalRecordUnreadableError({ reasons: lookup.reasons });
    }

    return lookup.value;
  }

  /**
   * The stored wait, or undefined once its key has expired. A blob that no longer decodes still
   * raises: corruption is not absence.
   */
  async findWait(waitId: string): Promise<StoredUserWait | undefined> {
    const lookup = await this.waits.find(waitId);
    if (lookup.kind === "miss") return undefined;
    if (lookup.kind === "unreadable") {
      throw new LangyLocalRecordUnreadableError({ reasons: lookup.reasons });
    }

    return lookup.value;
  }

  /** The wait, with its budget applied: a card past its time reads expired. */
  private async readSettlingExpiry(waitId: string): Promise<StoredUserWait | null> {
    const wait = await this.getWait(waitId).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "langy_local_record_not_found") {
        return null;
      }
      throw error;
    });
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
      await this.cards.publishPermission(wait);
    } else {
      await this.cards.publishQuestion(wait);
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
            answers: wait.answers as {
              question: string;
              selected: string[];
              other?: string;
            }[],
          }
        : {}),
    });
    await this.waits.untrackPending({
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      waitId: wait.waitId,
    });
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
    await this.cards.appendWaitingStatus(wait);
  }

  private async persist(wait: StoredUserWait): Promise<void> {
    // The record outlives its budget so a late answer can be told the card is
    // over, rather than that it never existed.
    const ttlSeconds = Math.max(60, Math.ceil((wait.expiresAt - this.now()) / 1000) + 300);
    await this.waits.save({ wait, ttlSeconds });
    if (wait.state === "pending") {
      await this.waits.trackPending({
        conversationId: wait.conversationId,
        turnId: wait.turnId,
        waitId: wait.waitId,
        expiresAt: wait.expiresAt,
        ttlSeconds,
      });
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
