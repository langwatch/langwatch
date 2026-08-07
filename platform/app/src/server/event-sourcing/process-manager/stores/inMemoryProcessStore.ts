import { nanoid } from "nanoid";
import type { ProcessRef } from "../processManager.types";
import type {
  CommitResult,
  DueWake,
  LeasedOutboxMessageRecord,
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
function isMessageDueForLease(
  message: StoredMessage,
  params: { now: number; processNames?: readonly string[] },
): boolean {
  if (message.status !== "pending") return false;
  if (
    params.processNames &&
    !params.processNames.includes(message.processName)
  ) {
    return false;
  }
  if (message.nextAttemptAt > params.now) return false;
  if (message.leasedUntil > params.now) return false;
  return true;
}

function isWakeAllowed(processName: string, allowed?: Set<string>): boolean {
  return !allowed || allowed.has(processName);
}

function toDueWakeIfDue(params: {
  instance: PersistedProcessInstance;
  now: number;
  allowed?: Set<string>;
}): DueWake | null {
  const { instance, now, allowed } = params;
  if (!isWakeAllowed(instance.ref.processName, allowed)) return null;
  if (instance.nextWakeAt === null || instance.nextWakeAt > now) return null;
  return {
    ref: instance.ref,
    revision: instance.revision,
    wakeAt: instance.nextWakeAt,
  };
}

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
  private readonly inbox = new Set<string>();
  private readonly messages = new Map<string, StoredMessage>();

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

    const insertedMessageKeys: string[] = [];
    const duplicateMessageKeys: string[] = [];
    for (const message of commit.messages) {
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
        processName: ref.processName,
        projectId: ref.projectId,
        processKey: ref.processKey,
        tenantId: commit.tenantId,
        sourceEventId,
        status: "pending",
        attempts: 0,
        nextAttemptAt: commit.now,
        leaseToken: null,
        createdAt: commit.now,
        leasedUntil: 0,
        dispatchedAt: null,
      });
      insertedMessageKeys.push(message.messageKey);
    }

    if (sourceEventId !== null) {
      this.inbox.add(inboxKey({ ref, sourceEventId }));
    }

    return {
      outcome: "committed",
      revision,
      insertedMessageKeys,
      duplicateMessageKeys,
    };
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
      if (!isMessageDueForLease(message, params)) continue;
      message.leasedUntil = params.now + params.leaseDurationMs;
      message.leaseToken = nanoid();
      leased.push({ ...message, leaseToken: message.leaseToken });
    }
    return leased;
  }

  async markDispatched(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
  }): Promise<void> {
    const message = this.messages.get(messageKeyOf(params.identity));
    if (!message || message.leaseToken !== params.leaseToken) return;
    message.status = "dispatched";
    message.attempts += 1;
    message.leasedUntil = 0;
    message.leaseToken = null;
    message.dispatchedAt = params.now;
  }

  async markFailed(params: {
    identity: OutboxMessageIdentity;
    leaseToken: string;
    now: number;
    nextAttemptAt: number;
    dead: boolean;
  }): Promise<void> {
    const message = this.messages.get(messageKeyOf(params.identity));
    if (!message || message.leaseToken !== params.leaseToken) return;
    message.attempts += 1;
    message.status = params.dead ? "dead" : "pending";
    message.nextAttemptAt = params.nextAttemptAt;
    message.leasedUntil = 0;
    message.leaseToken = null;
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
      const wake = toDueWakeIfDue({ instance, now: params.now, allowed });
      if (wake) due.push(wake);
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
      this.messages.delete(key);
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
      requeued++;
    }
    return requeued;
  }
}
