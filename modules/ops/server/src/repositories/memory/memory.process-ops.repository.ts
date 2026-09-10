import type { ProcessRef } from "@langwatch/eventing";
import type {
  DeadLetterCount,
  DeadOutboxMessageView,
  OutboxAttemptView,
  ProcessInstanceRow,
  ProcessOutboxMessageView,
  ProcessWakeRow,
} from "@langwatch/ops-contract";
import {
  ProcessOpsRepository,
  type ProcessNameCounts,
} from "../process-ops.repository.ts";
import type { MemoryOpsStore, MemoryOutboxRow } from "./memory.ops.store.ts";

/** One redrive or discard sweep moves at most this many rows, as the stored one does. */
const SWEEP_BATCH = 100;

/**
 * The process-manager fleet in memory: the same instance rows, wakes and
 * outbox messages the stored tables hold, so a process with no Postgres still
 * answers the operator surface and a redrive here is a redrive a read sees.
 */
export class MemoryProcessOpsRepository extends ProcessOpsRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryProcessOpsRepository {
    return new MemoryProcessOpsRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async countByProcessName({
    now,
    overdueWakeMs,
    overduePendingMs,
  }: {
    now: number;
    overdueWakeMs: number;
    overduePendingMs: number;
  }): Promise<ProcessNameCounts[]> {
    const names = new Set([
      ...this.store.processInstances.map((row) => row.processName),
      ...this.store.outbox.map((row) => row.processName),
    ]);

    return [...names].map((processName) => {
      const instances = this.store.processInstances.filter(
        (row) => row.processName === processName,
      );
      const messages = this.store.outbox.filter((row) => row.processName === processName);
      const pending = messages.filter((row) => row.status === "pending");

      return {
        processName,
        instances: instances.length,
        overdueWakes: instances.filter(
          (row) => row.nextWakeAt !== null && now - row.nextWakeAt > overdueWakeMs,
        ).length,
        pendingMessages: pending.length,
        overduePending: pending.filter(
          (row) => row.leasedUntil === null && now - row.nextAttemptAt > overduePendingMs,
        ).length,
        lapsedLeases: pending.filter((row) => row.leasedUntil !== null && row.leasedUntil < now)
          .length,
        deadMessages: messages.filter((row) => row.status === "dead").length,
      };
    });
  }

  async findInstances({
    processName,
    page,
    pageSize,
    search,
  }: {
    processName?: string;
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ instances: ProcessInstanceRow[]; total: number }> {
    const term = search?.trim().toLowerCase();
    const matching = this.store.processInstances.filter(
      (row) =>
        (processName === undefined || row.processName === processName) &&
        (term === undefined || term === "" || row.processKey.toLowerCase().includes(term)),
    );

    const instances = matching
      .slice(page * pageSize, page * pageSize + pageSize)
      .map((row) => ({
        ...row,
        pendingMessages: this.#messagesFor(row).filter((message) => message.status === "pending")
          .length,
        deadMessages: this.#messagesFor(row).filter((message) => message.status === "dead").length,
      }));

    return { instances, total: matching.length };
  }

  async findUpcomingWakes({ limit }: { limit: number }): Promise<ProcessWakeRow[]> {
    return this.store.processInstances
      .filter((row): row is typeof row & { nextWakeAt: number } => row.nextWakeAt !== null)
      .sort((left, right) => left.nextWakeAt - right.nextWakeAt)
      .slice(0, limit)
      .map(({ processName, projectId, processKey, nextWakeAt }) => ({
        processName,
        projectId,
        processKey,
        nextWakeAt,
      }));
  }

  async findOutboxMessages({
    ref,
    page,
    pageSize,
  }: {
    ref: ProcessRef;
    page: number;
    pageSize: number;
  }): Promise<{ messages: ProcessOutboxMessageView[]; total: number }> {
    const matching = this.store.outbox.filter((row) => sameRef(row, ref));

    return {
      messages: matching
        .slice(page * pageSize, page * pageSize + pageSize)
        .map((row) => messageView(row)),
      total: matching.length,
    };
  }

  async findDeadMessages({
    processName,
    page,
    pageSize,
  }: {
    processName?: string;
    page: number;
    pageSize: number;
  }): Promise<{ messages: DeadOutboxMessageView[]; total: number }> {
    const matching = this.store.outbox
      .filter(
        (row) =>
          row.status === "dead" && (processName === undefined || row.processName === processName),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt);

    return {
      messages: matching.slice(page * pageSize, page * pageSize + pageSize).map((row) => ({
        ...messageView(row),
        processName: row.processName,
        projectId: row.projectId,
        processKey: row.processKey,
        updatedAt: row.updatedAt,
      })),
      total: matching.length,
    };
  }

  async countDeadByProcessName(): Promise<DeadLetterCount[]> {
    const groups = new Map<string, MemoryOutboxRow[]>();

    for (const row of this.store.outbox) {
      if (row.status !== "dead") continue;
      groups.set(row.processName, [...(groups.get(row.processName) ?? []), row]);
    }

    return [...groups].map(([processName, rows]) => ({
      processName,
      count: rows.length,
      oldestUpdatedAt: Math.min(...rows.map((row) => row.updatedAt)),
    }));
  }

  async wakeInstanceNow({
    ref,
    now,
  }: {
    ref: ProcessRef;
    now: number;
  }): Promise<{ woke: boolean; previousWakeAt: number | null }> {
    const instance = this.store.processInstances.find((row) => sameRef(row, ref));
    if (!instance) return { woke: false, previousWakeAt: null };

    const previousWakeAt = instance.nextWakeAt;
    instance.nextWakeAt = now;
    instance.updatedAt = now;

    return { woke: true, previousWakeAt };
  }

  async tryRedriveDeadMessage(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null> {
    const row = this.#deadMessage(params);
    if (!row) return null;

    row.status = "pending";
    row.attempts = 0;
    row.nextAttemptAt = params.now;
    row.leasedUntil = null;
    row.updatedAt = params.now;

    return { messageKey: row.messageKey };
  }

  async tryDiscardDeadMessage(params: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null> {
    const row = this.#deadMessage(params);
    if (!row) return null;

    row.status = "discarded";
    row.updatedAt = params.now;

    return { messageKey: row.messageKey };
  }

  async redriveAllDeadMessages({
    processName,
    now,
  }: {
    processName?: string;
    now: number;
  }): Promise<number> {
    const batch = this.#deadBatch(processName);

    for (const [offset, row] of batch.entries()) {
      row.status = "pending";
      row.attempts = 0;
      // Spread the due times so a released backlog is not one batch.
      row.nextAttemptAt = now + offset * 100;
      row.leasedUntil = null;
      row.updatedAt = now;
    }

    return batch.length;
  }

  async discardAllDeadMessages({
    processName,
    now,
  }: {
    processName?: string;
    now: number;
  }): Promise<number> {
    const batch = this.#deadBatch(processName);

    for (const row of batch) {
      row.status = "discarded";
      row.updatedAt = now;
    }

    return batch.length;
  }

  async findAttempts(): Promise<OutboxAttemptView[]> {
    // The memory store keeps no attempt ledger: a failure is recorded by the
    // dispatcher, and no dispatcher runs against this tier.
    return [];
  }

  async tryReleaseLapsedLease({
    ref,
    messageId,
    now,
  }: {
    ref: ProcessRef;
    messageId: string;
    now: number;
  }): Promise<{ messageKey: string } | null> {
    const row = this.store.outbox.find(
      (candidate) =>
        candidate.id === messageId &&
        sameRef(candidate, ref) &&
        candidate.status === "pending" &&
        candidate.leasedUntil !== null &&
        candidate.leasedUntil < now,
    );
    if (!row) return null;

    row.leasedUntil = null;
    row.updatedAt = now;

    return { messageKey: row.messageKey };
  }

  #messagesFor(ref: ProcessRef): MemoryOutboxRow[] {
    return this.store.outbox.filter((row) => sameRef(row, ref));
  }

  #deadMessage({
    ref,
    messageId,
  }: {
    ref: ProcessRef;
    messageId: string;
  }): MemoryOutboxRow | undefined {
    return this.store.outbox.find(
      (row) => row.id === messageId && row.status === "dead" && sameRef(row, ref),
    );
  }

  #deadBatch(processName: string | undefined): MemoryOutboxRow[] {
    return this.store.outbox
      .filter(
        (row) =>
          row.status === "dead" && (processName === undefined || row.processName === processName),
      )
      .slice(0, SWEEP_BATCH);
  }
}

function sameRef(row: ProcessRef, ref: ProcessRef): boolean {
  return (
    row.processName === ref.processName &&
    row.projectId === ref.projectId &&
    row.processKey === ref.processKey
  );
}

function messageView(row: MemoryOutboxRow): ProcessOutboxMessageView {
  return {
    id: row.id,
    messageKey: row.messageKey,
    intentType: row.intentType,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    leasedUntil: row.leasedUntil,
    createdAt: row.createdAt,
    sourceEventId: row.sourceEventId,
    traceId: row.traceId,
    payload: row.payload,
  };
}
