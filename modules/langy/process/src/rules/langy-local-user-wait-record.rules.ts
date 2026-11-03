import {
  LangyWaitExpiredError,
  type LangyUserWaitEndedEventData,
  type LangyUserWaitStartedEventData,
  type PollWaitResponse,
} from "@langwatch/langy-contract";
/**
 * The user wait as a record and as a refusal: what the platform keeps about one card while it
 * is on screen, the answer shape the panel polls for, and the error a second answer gets. No
 * store and no command dispatch is reachable from here.
 */
import { z } from "zod";

import type { LangyTokenBufferRepository } from "../repositories/langy-token-buffer.repository.ts";

/**
 * What a confirmation card the platform raised itself asks about, and the ids of its options.
 * The answer is read against these ids, never against what a label says.
 */
export const userWaitConfirmSchema = z.object({
  /** The question as the card printed it, which an answer names. */
  question: z.string(),
  resource: z.string(),
  action: z.string(),
  id: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  yesOptionId: z.string(),
});
export type UserWaitConfirm = z.infer<typeof userWaitConfirmSchema>;

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
  /** Set on a confirmation card the platform raised; such a card outlives its turn. */
  confirm: userWaitConfirmSchema.optional(),
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
  LangyTokenBufferRepository,
  "appendLocalPermission" | "appendQuestion" | "appendStatus" | "heartbeat"
>;

/** What one question asks, as the worker sends it. */
export interface UserWaitQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string; quiet?: boolean }[];
  multiple?: boolean;
  allowOther?: boolean;
  bare?: boolean;
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
          answers: wait.answers as {
            question: string;
            selected: string[];
            other?: string;
          }[],
        }
      : {}),
  };
}

/** A card as it starts: pending, with only the fields the caller gave. */
export function blankUserWait({
  waitId,
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
  confirm,
}: {
  waitId: string;
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
  confirm?: UserWaitConfirm;
}): StoredUserWait {
  const createdAt = now;

  return {
    waitId,
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
      confirm,
    }),
  };
}

/** The live permission card entry for one wait. */
export function permissionCardEntry({
  wait,
  callId,
}: {
  wait: StoredUserWait;
  callId: string;
}): Parameters<UserWaitBuffer["appendLocalPermission"]>[0]["entry"] {
  return {
    waitId: wait.waitId,
    callId,
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
  };
}

/** The live question card entry for one wait. */
export function questionCardEntry(
  wait: StoredUserWait,
): Parameters<UserWaitBuffer["appendQuestion"]>[0]["entry"] {
  return {
    waitId: wait.waitId,
    ...(wait.toolCallId ? { toolCallId: wait.toolCallId } : {}),
    questions: wait.questions ?? [],
    status: wait.state,
    ...(wait.answers !== undefined ? { answers: wait.answers } : {}),
  };
}
