import { nanoid } from "nanoid";
import type { ProcessRef } from "../processManager.types";
import type {
  AppendIntentsResult,
  CommitResult,
  DueWake,
  FailedOutboxAttempt,
  LeasedOutboxMessageRecord,
  NewOutboxMessage,
  OutboxMessageIdentity,
  OutboxMessageRecord,
  PersistedProcessInstance,
  ProcessCommit,
  ProcessStore,
} from "./processStore.types";

interface StoredMessage extends OutboxMessageRecord {
  /** Epoch ms until which the message is exclusively leased; 0 = unleased. */
  leasedUntil: number;
  /** Epoch ms of the successful dispatch; null while pending/dead. */
  dispatchedAt: number | null;
  /**
   * Epoch ms of the last write to this row, mirroring the durable store's
   * `updatedAt` column. The dead-row sweep reaps by this and not by
   * `nextAttemptAt`: that one is retry scheduling and on a dead row still
   * carries the backoff the last attempt computed, which can sit arbitrarily
   * far from the moment the row was actually retired.
   */
  updatedAt: number;
}

function refKey(ref: ProcessRef): string {
  return `${ref.processName}|${ref.projectId}|${ref.processKey}`;
}

function inboxKey({
  ref,
  sourceEventId,
}: {
  ref: ProcessRef;
  sourceEventId: string;
}): string {
  return `${ref.processName}|${ref.projectId}|${sourceEventId}`;
}

function messageKeyOf(identity: OutboxMessageIdentity): string {
  return `${identity.processName}|${identity.projectId}|${identity.messageKey}`;
}

/**
 * A dead message belonging to one process instance, optionally narrowed to a
 * message-key prefix. An absent prefix matches every dead message of the
 * instance.
 */
function isRequeueTarget(
  message: StoredMessage,
  target: {
    processName: string;
    projectId: string;
    processKey: string;
    messageKeyPrefix?: string;
  },
): boolean {
  if (message.processName !== target.processName) return false;
  if (message.projectId !== target.projectId) return false;
  if (message.processKey !== target.processKey) return false;
  if (message.status !== "dead") return false;
  return (
    !target.messageKeyPrefix ||
    message.messageKey.startsWith(target.messageKeyPrefix)
  );
}

/**
 * In-memory ProcessStore for unit tests. Each call is
 * synchronous under the hood, so every `commit` is trivially atomic — the
 * same all-or-nothing contract the Postgres implementation must provide in
 * one transaction.
 */
export class InMemoryProcessStore implements ProcessStore {
  private readonly instances = new Map<string, PersistedProcessInstance>();
  /** Inbox key to the epoch ms it was consumed at, which retention reaps by. */
  private readonly inbox = new Map<string, number>();
  private readonly messages = new Map<string, StoredMessage>();
  private readonly attempts = new Map<string, FailedOutboxAttempt[]>();

  async findByRef<State = unknown>(params: {
    ref: ProcessRef;
  }): Promise<PersistedProcessInstance<State> | null> {
    const instance = this.instances.get(refKey(params.ref));
    return (instance as PersistedProcessInstance<State> | undefined) ?? null;
  }

  async commit<State = unknown>(
    commit: ProcessCommit<State>,
  ): Promise<CommitResult> {
    const { ref, sourceEventId } = commit;

    if (
      sourceEventId !== null &&
      this.inbox.has(inboxKey({ ref, sourceEventId }))
    ) {
      return { outcome: "duplicateEvent" };
    }

    const existing = this.instances.get(refKey(ref));
    const actualRevision = existing?.revision ?? 0;
    if (actualRevision !== commit.expectedRevision) {
      return { outcome: "revisionConflict", actualRevision };
    }

    const revision = actualRevision + 1;
    this.instances.set(refKey(ref), {
      ref,
      tenantId: commit.tenantId,
      ...(commit.userId ? { userId: commit.userId } : {}),
      state: commit.state,
      revision,
      nextWakeAt: commit.nextWakeAt,
      updatedAt: commit.now,
    });

    const { insertedMessageKeys, duplicateMessageKeys } = this.insertMessages({
      ref,
      tenantId: commit.tenantId,
      sourceEventId,
      messages: commit.messages,
      now: commit.now,
    });

    if (sourceEventId !== null) {
      this.inbox.set(inboxKey({ ref, sourceEventId }), commit.now);
    }

    return {
      outcome: "committed",
      revision,
      insertedMessageKeys,
      duplicateMessageKeys,
    };
  }

  /**
   * The transient path: intents only, no instance and no inbox marker. The
   * durable adapter drops its transaction here too; this one is atomic per
   * call regardless, so the shared insert is the whole implementation.
   */
  async appendIntents(params: {
    ref: ProcessRef;
    tenantId: string;
    userId?: string;
    sourceEventId: string | null;
    messages: NewOutboxMessage[];
    now: number;
  }): Promise<AppendIntentsResult> {
    return this.insertMessages(params);
  }

  /** Idempotent outbox insert by (processName, projectId, messageKey). */
  private insertMessages(params: {
    ref: ProcessRef;
    tenantId: string;
    userId?: string;
    sourceEventId: string | null;
    messages: NewOutboxMessage[];
    now: number;
  }): AppendIntentsResult {
    const { ref } = params;
    const insertedMessageKeys: string[] = [];
    const duplicateMessageKeys: string[] = [];
    for (const message of params.messages) {
      const identity = messageKeyOf({
        processName: ref.processName,
        projectId: ref.projectId,
        messageKey: message.messageKey,
      });
      if (this.messages.has(identity)) {
        duplicateMessageKeys.push(message.messageKey);
        continue;
      }
      this.messages.set(identity, {
        ...message,
        ...((message.userId ?? params.userId)
          ? { userId: message.userId ?? params.userId }
          : {}),
        processName: ref.processName,
        projectId: ref.projectId,
        processKey: ref.processKey,
        tenantId: params.tenantId,
        sourceEventId: params.sourceEventId,
        status: "pending",
        attempts: 0,
        nextAttemptAt: params.now,
        leaseToken: null,
        createdAt: params.now,
        leasedUntil: 0,
        dispatchedAt: null,
        updatedAt: params.now,
      });
      insertedMessageKeys.push(message.messageKey);
    }
    return { insertedMessageKeys, duplicateMessageKeys };
  }

  async findMessagesByRef(params: {
    ref: ProcessRef;
  }): Promise<OutboxMessageRecord[]> {
    return [...this.messages.values()].filter(
      (message) =>
        message.processName === params.ref.processName &&
        message.projectId === params.ref.projectId &&
        message.processKey === params.ref.processKey,
    );
  }

  async leaseDueMessages(params: {
    now: number;
    limit: number;
    leaseDurationMs: number;
    processNames?: readonly string[];
  }): Promise<LeasedOutboxMessageRecord[]> {
    const leased: LeasedOutboxMessageRecord[] = [];
    for (const message of this.messages.values()) {
      if (leased.length >= params.limit) break;
      if (message.status !== "pending") continue;
      if (
        params.processNames &&
        !params.processNames.includes(message.processName)
      )
        continue;
      if (message.nextAttemptAt > params.now) continue;
      if (message.leasedUntil > params.now) continue;
      message.leasedUntil = params.now + params.leaseDurationMs;
      message.leaseToken = nanoid();
      message.attempts += 1;
      leased.push({ ...message, leaseToken: message.leaseToken });
    }
    return leased;
  }

  async markDispatched(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
  }): Promise<{ applied: boolean }> {
    const message = this.messages.get(messageKeyOf(params.identity));
    if (!message || message.leaseToken !== params.leaseToken) {
      return { applied: false };
    }
    message.status = "dispatched";
    message.leasedUntil = 0;
    message.leaseToken = null;
    message.dispatchedAt = params.now;
    message.updatedAt = params.now;
    return { applied: true };
  }

  async markFailed(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
    nextAttemptAt: number;
    dead: boolean;
  }): Promise<{ applied: boolean }> {
    const message = this.messages.get(messageKeyOf(params.identity));
    if (!message || message.leaseToken !== params.leaseToken) {
      return { applied: false };
    }
    message.status = params.dead ? "dead" : "pending";
    message.nextAttemptAt = params.nextAttemptAt;
    message.leasedUntil = 0;
    message.leaseToken = null;
    message.updatedAt = params.now;
    return { applied: true };
  }

  async recordFailedAttempt(params: {
    identity: OutboxMessageIdentity;
    attempt: FailedOutboxAttempt;
  }): Promise<void> {
    if (!this.messages.has(messageKeyOf(params.identity))) return;
    const existing = this.attempts.get(messageKeyOf(params.identity)) ?? [];
    existing.push(params.attempt);
    this.attempts.set(messageKeyOf(params.identity), existing);
  }

  /** Test read for the attempt history, mirroring the durable table. */
  findFailedAttempts(identity: OutboxMessageIdentity): FailedOutboxAttempt[] {
    return this.attempts.get(messageKeyOf(identity)) ?? [];
  }

  async releaseLease(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
  }): Promise<{ applied: boolean }> {
    const message = this.messages.get(messageKeyOf(params.identity));
    if (!message || message.leaseToken !== params.leaseToken) {
      return { applied: false };
    }
    // Hand back the attempt the lease charged: the delivery never started.
    message.attempts -= 1;
    message.leasedUntil = 0;
    message.leaseToken = null;
    message.updatedAt = params.now;
    return { applied: true };
  }

  async findDueWakes(params: {
    now: number;
    limit: number;
    processNames?: readonly string[];
  }): Promise<DueWake[]> {
    if (params.processNames && params.processNames.length === 0) return [];
    const allowed = params.processNames
      ? new Set(params.processNames)
      : undefined;
    const due: DueWake[] = [];
    for (const instance of this.instances.values()) {
      if (due.length >= params.limit) break;
      if (allowed && !allowed.has(instance.ref.processName)) continue;
      if (instance.nextWakeAt === null || instance.nextWakeAt > params.now) {
        continue;
      }
      due.push({
        ref: instance.ref,
        revision: instance.revision,
        wakeAt: instance.nextWakeAt,
      });
    }
    return due;
  }

  async deleteDispatchedBefore(params: {
    processName: string;
    before: number;
  }): Promise<number> {
    let deleted = 0;
    for (const [key, message] of this.messages) {
      if (message.processName !== params.processName) continue;
      if (message.status !== "dispatched") continue;
      if (
        message.dispatchedAt === null ||
        message.dispatchedAt >= params.before
      )
        continue;
      this.deleteMessage(key);
      deleted++;
    }
    return deleted;
  }

  /**
   * Every outbox deletion goes through here, so the attempt rows leave with
   * their message on all of them — the durable store cascades, and a fake
   * that shed them on only one path would model a leak the real one does not
   * have.
   */
  private deleteMessage(key: string): void {
    this.messages.delete(key);
    this.attempts.delete(key);
  }

  async deleteDispatchedOutboxBatch(params: {
    before: number;
    limit: number;
  }): Promise<number> {
    return this.deleteOutboxBatch(
      params,
      (message) =>
        message.status === "dispatched" &&
        message.dispatchedAt !== null &&
        message.dispatchedAt < params.before,
    );
  }

  async deleteDeadOutboxBatch(params: {
    before: number;
    limit: number;
  }): Promise<number> {
    // Reaped by `updatedAt`, the same column the durable store uses, which
    // the markFailed that retired the row stamped. `discarded` rides the same
    // family for the reason given on the durable store: no other predicate
    // matches it, so leaving it out makes it immortal.
    return this.deleteOutboxBatch(
      params,
      (message) =>
        (message.status === "dead" || message.status === "discarded") &&
        message.updatedAt < params.before,
    );
  }

  async deleteConsumedInboxBatch(params: {
    before: number;
    limit: number;
  }): Promise<number> {
    if (params.limit <= 0) return 0;
    let deleted = 0;
    for (const [key, consumedAt] of this.inbox) {
      if (deleted >= params.limit) break;
      if (consumedAt >= params.before) continue;
      this.inbox.delete(key);
      deleted++;
    }
    return deleted;
  }

  private deleteOutboxBatch(
    params: { limit: number },
    matches: (message: StoredMessage) => boolean,
  ): number {
    if (params.limit <= 0) return 0;
    let deleted = 0;
    for (const [key, message] of this.messages) {
      if (deleted >= params.limit) break;
      if (!matches(message)) continue;
      this.deleteMessage(key);
      deleted++;
    }
    return deleted;
  }

  async requeueDeadMessages(params: {
    processName: string;
    projectId: string;
    processKey: string;
    messageKeyPrefix?: string;
    now: number;
  }): Promise<number> {
    let requeued = 0;
    for (const message of this.messages.values()) {
      if (!isRequeueTarget(message, params)) continue;
      message.status = "pending";
      message.attempts = 0;
      message.nextAttemptAt = params.now;
      message.leaseToken = null;
      message.updatedAt = params.now;
      requeued++;
    }
    return requeued;
  }
}
