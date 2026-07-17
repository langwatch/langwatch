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
      if (message.status !== "pending") continue;
      if (params.processNames && !params.processNames.includes(message.processName))
        continue;
      if (message.nextAttemptAt > params.now) continue;
      if (message.leasedUntil > params.now) continue;
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
  }): Promise<DueWake[]> {
    const due: DueWake[] = [];
    for (const instance of this.instances.values()) {
      if (due.length >= params.limit) break;
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
      if (message.dispatchedAt === null || message.dispatchedAt >= params.before)
        continue;
      this.messages.delete(key);
      deleted++;
    }
    return deleted;
  }
}
