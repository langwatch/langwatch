/**
 * The user wait as a record and as a refusal: what the platform keeps about one card while it
 * is on screen, the answer shape the panel polls for, and the error a second answer gets. No
 * store and no command dispatch is reachable from here.
 */
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  LangyWaitExpiredError,
  type LangyUserWaitEndedEventData,
  type LangyUserWaitStartedEventData,
  type PollWaitResponse,
} from "@langwatch/langy-contract";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import type { LangyTokenBufferPort } from "../ports/langy-token-buffer.port.ts";

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
  /** Every pattern one session grant covers, first one first. */
  patterns: z.array(z.string()).optional(),
  reason: z.string().optional(),
  /** The seconds after which the command is stopped, when it runs under one. */
  timeoutSeconds: z.number().optional(),
  skipOffered: z.boolean().optional(),
  workspaceName: z.string().optional(),
  hostname: z.string().optional(),
  questions: z.unknown().optional(),
  decision: z.enum(["allow_once", "allow_pattern", "deny"]).optional(),
  /** Where the answer was given. Absent means the card in the panel. */
  source: z.enum(["panel", "terminal"]).optional(),
  answers: z.unknown().optional(),
  answeredBy: z.string().optional(),
});
export type StoredUserWait = z.infer<typeof storedUserWaitSchema>;

/** The fields that were given; an explicit `undefined` is dropped, not stored. */
export function given<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

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

/** The live half: the entries the panel wakes up on, and the turn's liveness. */
export type UserWaitBuffer = Pick<
  LangyTokenBufferPort,
  "appendLocalPermission" | "appendQuestion" | "appendStatus" | "heartbeat"
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
  store: SessionStateStore;
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

/**
 * The refusal a second answer gets, carrying how the card ended so the panel
 * can say what happened instead.
 * @throws {LangyWaitExpiredError} always
 */
export function refuseSettled({
  waitId,
  wait,
}: {
  waitId: string;
  wait: StoredUserWait | null;
}): never {
  const ended = wait?.state;

  throw new LangyWaitExpiredError({
    waitId,
    ...(ended && ended !== "pending" ? { outcome: ended } : {}),
    ...(wait?.decision ? { decision: wait.decision } : {}),
    ...(wait?.source ? { source: wait.source } : {}),
  });
}

export function toPollResponse(wait: StoredUserWait): PollWaitResponse {
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

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

/** A card as it starts: pending, with only the fields the caller gave. */
export function blankUserWait({
  now,
  projectId,
  conversationId,
  turnId,
  toolCallId,
  kind,
  budgetMs,
  callId,
  summary,
  pattern,
  patterns,
  reason,
  timeoutSeconds,
  skipOffered,
  workspaceName,
  hostname,
  questions,
}: {
  now: number;
  projectId: string;
  conversationId: string;
  turnId: string;
  toolCallId?: string;
  kind: "permission" | "question";
  budgetMs: number;
  callId?: string;
  summary?: string;
  pattern?: string;
  patterns?: string[];
  reason?: string;
  timeoutSeconds?: number;
  skipOffered?: boolean;
  workspaceName?: string;
  hostname?: string;
  questions?: UserWaitQuestion[];
}): StoredUserWait {
  const createdAt = now;

  return {
    waitId: `lwait_${nanoid()}`,
    projectId,
    conversationId,
    turnId,
    kind,
    state: "pending",
    createdAt,
    expiresAt: createdAt + budgetMs,
    lastKeepaliveAt: createdAt,
    ...given({
      toolCallId,
      callId,
      summary,
      pattern,
      patterns,
      reason,
      timeoutSeconds,
      skipOffered,
      workspaceName,
      hostname,
      questions,
    }),
  };
}
