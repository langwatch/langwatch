/**
 * The user wait: one primitive behind the permission card and the question
 * card (ADR-129).
 *
 * A tool asks, the turn stays in flight, the developer answers in the panel,
 * and the tool returns with the answer and its plan intact. Three rules decide
 * the design:
 *
 * - **Durable first.** A tab that adopted a running turn from Recent chats
 *   never subscribes to the live stream, so a live-only card would reach
 *   exactly one tab. The durable `user_wait_started` event is the card; the
 *   live entry is the fast path for the tab that sent the message.
 * - **The live stream has to be kept alive.** Its key expires 180 s after the
 *   last append, and a wait appends nothing while it waits. Every poll that
 *   crosses the keepalive interval writes one `status` entry, which restores
 *   the full window. The poll is where it happens, so there is no timer to own
 *   and no pod that has to stay the same one.
 * - **One terminal.** An answer, an expiry and a turn's Stop contend for the
 *   same transition, so a late answer to an expired card changes nothing and
 *   the record never contradicts itself.
 */

import type {
  LangyUserWaitEndedEventData,
  LangyUserWaitStartedEventData,
} from "@langwatch/langy";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { LangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import type { AgentStateStore } from "~/server/connected-agents/state-store";
import {
  CALL_POLL_HOLD_MS,
  LIVE_STREAM_KEEPALIVE_MS,
  PERMISSION_WAIT_BUDGET_MS,
  POLL_INTERVAL_MS,
  QUESTION_WAIT_BUDGET_MS,
} from "./constants";
import { LangyWaitExpiredError } from "./errors";
import type { PollWaitResponse } from "./http";
import { turnWaitsKey, waitKey } from "./keys";

const logger = createLogger("langwatch:langy:local-control:waits");

/** What the platform keeps about one card while it is on screen. */
export const storedUserWaitSchema = z.object({
  waitId: z.string(),
  projectId: z.string(),
  conversationId: z.string(),
  turnId: z.string(),
  toolCallId: z.string().optional(),
  kind: z.enum(["permission", "question"]),
  state: z.enum(["pending", "answered", "expired", "cancelled"]),
  createdAt: z.number(),
  expiresAt: z.number(),
  lastKeepaliveAt: z.number(),
  /** Set on a permission wait: the local call the answer releases. */
  callId: z.string().optional(),
  summary: z.string().optional(),
  pattern: z.string().optional(),
  reason: z.string().optional(),
  skipOffered: z.boolean().optional(),
  workspaceName: z.string().optional(),
  hostname: z.string().optional(),
  questions: z.unknown().optional(),
  decision: z.enum(["allow_once", "allow_pattern", "deny"]).optional(),
  answers: z.unknown().optional(),
  answeredBy: z.string().optional(),
});
export type StoredUserWait = z.infer<typeof storedUserWaitSchema>;

/** The durable half, as two command dispatches this service does not own. */
export interface UserWaitEvents {
  startUserWait(
    data: LangyUserWaitStartedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
  endUserWait(
    data: LangyUserWaitEndedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

/** The live half: the entries the panel wakes up on. */
export type UserWaitBuffer = Pick<
  LangyTokenBuffer,
  "appendLocalPermission" | "appendQuestion" | "appendStatus"
>;

/** What one question asks, as the worker sends it. */
export interface UserWaitQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiple?: boolean;
  allowOther?: boolean;
}

export interface UserWaitServiceOptions {
  store: AgentStateStore;
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
  now?: () => number;
  pollIntervalMs?: number;
  keepaliveMs?: number;
}

export class UserWaitService {
  private readonly store: AgentStateStore;
  private readonly events: UserWaitEvents;
  private readonly buffer: UserWaitBuffer;
  private readonly sendPermission: NonNullable<
    UserWaitServiceOptions["sendPermission"]
  >;
  private readonly pollIntervalMs: number;
  private readonly keepaliveMs: number;
  readonly now: () => number;

  constructor(options: UserWaitServiceOptions) {
    this.store = options.store;
    this.events = options.events;
    this.buffer = options.buffer;
    this.sendPermission = options.sendPermission ?? (async () => undefined);
    this.now = options.now ?? (() => Date.now());
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
    reason: string;
    skipOffered: boolean;
    workspaceName: string;
    hostname: string;
  }): Promise<StoredUserWait> {
    const wait = this.blank({
      ...params,
      kind: "permission",
      budgetMs: PERMISSION_WAIT_BUDGET_MS,
    });
    await this.persist(wait);
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
        reason: params.reason,
        skipOffered: params.skipOffered,
        workspaceName: params.workspaceName,
        hostname: params.hostname,
      },
    });
    await this.publishPermission(wait);
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
    const wait = this.blank({
      ...params,
      kind: "question",
      budgetMs: QUESTION_WAIT_BUDGET_MS,
    });
    await this.persist(wait);
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
    await this.publishQuestion(wait);
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
  }): Promise<PollWaitResponse | null> {
    const until = this.now() + holdMs;
    for (;;) {
      const wait = await this.readSettlingExpiry(waitId);
      if (!wait) return null;
      if (wait.state !== "pending") return toPollResponse(wait);
      await this.keepAlive(wait);
      if (this.now() >= until || signal?.aborted) return toPollResponse(wait);
      await sleep(this.pollIntervalMs, signal);
    }
  }

  /**
   * The developer answered.
   *
   * @throws {LangyWaitExpiredError} the card is not waiting any more, so the
   * panel falls back to sending the answer as the next message
   */
  async answer({
    waitId,
    userId,
    decision,
    answers,
  }: {
    waitId: string;
    userId: string;
    decision?: "allow_once" | "allow_pattern" | "deny";
    answers?: Array<{ question: string; selected: string[]; other?: string }>;
  }): Promise<StoredUserWait> {
    const wait = await this.readSettlingExpiry(waitId);
    if (wait?.state !== "pending") throw new LangyWaitExpiredError({ waitId });

    const answered: StoredUserWait = {
      ...wait,
      state: "answered",
      answeredBy: userId,
      ...(decision ? { decision } : {}),
      ...(answers ? { answers } : {}),
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
    const ids = await this.store.zrangebyscore(
      turnWaitsKey(conversationId, turnId),
      0,
    );
    const pending: StoredUserWait[] = [];
    for (const id of ids) {
      const wait = await this.read(id);
      if (wait?.state === "pending") pending.push(wait);
    }
    return pending;
  }

  async read(waitId: string): Promise<StoredUserWait | null> {
    const raw = await this.store.get(waitKey(waitId));
    if (!raw) return null;
    try {
      const parsed = storedUserWaitSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** The wait, with its budget applied: a card past its time reads expired. */
  private async readSettlingExpiry(
    waitId: string,
  ): Promise<StoredUserWait | null> {
    const wait = await this.read(waitId);
    if (!wait) return null;
    if (wait.state !== "pending" || wait.expiresAt > this.now()) return wait;
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
    logger.info(
      { waitId, kind: expired.kind },
      "user wait passed its budget with no answer",
    );
    return expired;
  }

  /** Writes the terminal event and locks the card on the live edge. */
  private async end(
    wait: StoredUserWait,
    outcome: "answered" | "expired" | "cancelled",
  ): Promise<void> {
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
    await this.store.zrem(
      turnWaitsKey(wait.conversationId, wait.turnId),
      wait.waitId,
    );
    if (wait.kind === "permission") await this.publishPermission(wait);
    else await this.publishQuestion(wait);
  }

  /**
   * One `status` entry when the keepalive interval has passed. It renders
   * behind the tool card that is already on screen, so its only job is to push
   * the live stream's expiry back out to a full window.
   */
  private async keepAlive(wait: StoredUserWait): Promise<void> {
    const now = this.now();
    if (now - wait.lastKeepaliveAt < this.keepaliveMs) return;
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
    if (!wait.callId) return;
    await this.buffer.appendLocalPermission({
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      entry: {
        waitId: wait.waitId,
        callId: wait.callId,
        ...(wait.toolCallId ? { toolCallId: wait.toolCallId } : {}),
        summary: wait.summary ?? "",
        pattern: wait.pattern ?? "",
        reason: wait.reason ?? "",
        skipOffered: wait.skipOffered ?? false,
        workspaceName: wait.workspaceName ?? "",
        hostname: wait.hostname ?? "",
        status: wait.state,
        ...(wait.decision ? { decision: wait.decision } : {}),
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

  private blank({
    projectId,
    conversationId,
    turnId,
    toolCallId,
    kind,
    budgetMs,
    callId,
    summary,
    pattern,
    reason,
    skipOffered,
    workspaceName,
    hostname,
    questions,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId?: string;
    kind: "permission" | "question";
    budgetMs: number;
    callId?: string;
    summary?: string;
    pattern?: string;
    reason?: string;
    skipOffered?: boolean;
    workspaceName?: string;
    hostname?: string;
    questions?: UserWaitQuestion[];
  }): StoredUserWait {
    const createdAt = this.now();
    return {
      waitId: `lwait_${nanoid()}`,
      projectId,
      conversationId,
      turnId,
      ...(toolCallId ? { toolCallId } : {}),
      kind,
      state: "pending",
      createdAt,
      expiresAt: createdAt + budgetMs,
      lastKeepaliveAt: createdAt,
      ...(callId ? { callId } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(pattern !== undefined ? { pattern } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(skipOffered !== undefined ? { skipOffered } : {}),
      ...(workspaceName !== undefined ? { workspaceName } : {}),
      ...(hostname !== undefined ? { hostname } : {}),
      ...(questions !== undefined ? { questions } : {}),
    };
  }

  private async persist(wait: StoredUserWait): Promise<void> {
    // The record outlives its budget so a late answer can be told the card is
    // over, rather than that it never existed.
    const ttlSeconds = Math.max(
      60,
      Math.ceil((wait.expiresAt - this.now()) / 1000) + 300,
    );
    await this.store.set(
      waitKey(wait.waitId),
      JSON.stringify(wait),
      ttlSeconds,
    );
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

function toPollResponse(wait: StoredUserWait): PollWaitResponse {
  return {
    waitId: wait.waitId,
    state: wait.state,
    ...(wait.answers !== undefined
      ? {
          answers: wait.answers as Array<{
            question: string;
            selected: string[];
            other?: string;
          }>,
        }
      : {}),
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
