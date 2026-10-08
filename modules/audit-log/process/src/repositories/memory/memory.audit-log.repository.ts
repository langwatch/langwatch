import {
  auditLogHistoryEntrySchema,
  auditLogTargetEntrySchema,
  type AuditLogEntry,
  type AuditLogHistoryEntry,
  type AuditLogTargetEntry,
  type FindAuditLogByTargetKindInput,
  type AuditLogJsonValue,
  type ListAuditLogEntityHistoryInput,
  type RecordedAuditLogEntry,
  type RecordedSinceInput,
} from "@langwatch/audit-log-contract";
import { generate } from "@langwatch/ksuid";
import { Temporal, nowInstant, toDate } from "@langwatch/time";

import type { AuditLogRepository } from "../audit-log.repository.ts";
import type { MemoryAuditLogRow, MemoryAuditLogStore } from "./memory.audit-log.store.ts";

export class MemoryAuditLogRepository implements AuditLogRepository {
  private constructor(private readonly store: MemoryAuditLogStore) {}

  static create({ store }: { store: MemoryAuditLogStore }): MemoryAuditLogRepository {
    return new MemoryAuditLogRepository(store);
  }

  async create(entry: AuditLogEntry): Promise<RecordedAuditLogEntry> {
    const row = { ...entry, id: generate("audit").toString(), createdAt: nowInstant() };
    this.store.rows.push(row);
    return { id: row.id, occurredAt: row.createdAt.epochMilliseconds };
  }

  async createOnce({
    entry,
    idempotencyKey,
    occurredAt,
  }: {
    entry: AuditLogEntry;
    idempotencyKey: string;
    occurredAt: number;
  }): Promise<RecordedAuditLogEntry> {
    const existing = this.store.rows.find((row) => row.idempotencyKey === idempotencyKey);
    if (existing !== undefined) {
      return { id: existing.id, occurredAt: existing.createdAt.epochMilliseconds };
    }
    const id = generate("audit").toString();
    this.store.rows.push({
      ...entry,
      id,
      idempotencyKey,
      createdAt: Temporal.Instant.fromEpochMilliseconds(occurredAt),
    });
    return { id, occurredAt };
  }

  async hasRecordedSince(input: RecordedSinceInput): Promise<boolean> {
    return this.store.rows.some(
      (row) =>
        row.userId === input.userId &&
        row.action === input.action &&
        row.targetKind === input.targetKind &&
        row.targetId === input.targetId &&
        row.createdAt.epochMilliseconds >= input.sinceMs,
    );
  }

  async findEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]> {
    const matches = this.store.rows
      .filter((row) => matchesEntity(row, input))
      .toSorted((left, right) => Temporal.Instant.compare(right.createdAt, left.createdAt))
      .slice(0, input.limit);

    return matches.map((row) =>
      auditLogHistoryEntrySchema.parse({
        id: row.id,
        userId: row.userId,
        action: row.action,
        createdAt: toDate(row.createdAt),
        args: row.args ?? null,
      }),
    );
  }

  async findByTargetKind(input: FindAuditLogByTargetKindInput): Promise<AuditLogTargetEntry[]> {
    // Reversed first, so entries written in one millisecond read last-written first.
    return this.store.rows
      .filter((row) => row.targetKind === input.targetKind)
      .toReversed()
      .toSorted((left, right) => Temporal.Instant.compare(right.createdAt, left.createdAt))
      .slice(0, input.limit)
      .map((row) =>
        auditLogTargetEntrySchema.parse({
          id: row.id,
          createdAt: toDate(row.createdAt),
          action: row.action,
          targetId: row.targetId ?? null,
          projectId: row.projectId ?? null,
          userId: row.userId ?? null,
          metadata: row.metadata ?? null,
        }),
      );
  }
}

function matchesEntity(row: MemoryAuditLogRow, input: ListAuditLogEntityHistoryInput): boolean {
  const inProject = row.projectId === input.projectId;
  const inFamily = row.action.startsWith(input.actionPrefix);
  const namesEntity = input.argumentNames.some(
    (name) => argumentOf(row.args, name) === input.entityId,
  );

  return inProject && inFamily && namesEntity;
}

function argumentOf(args: AuditLogJsonValue | undefined, name: string): AuditLogJsonValue {
  const isRecord = args !== null && typeof args === "object" && !Array.isArray(args);

  return isRecord && args !== undefined ? (args[name] ?? null) : null;
}
