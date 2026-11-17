import {
  auditLogExportEntrySchema,
  auditLogHistoryEntrySchema,
  auditLogTargetEntrySchema,
  type AuditLogEntry,
  type AuditLogExportEntry,
  type AuditLogHistoryEntry,
  type AuditLogTargetEntry,
  type FindAuditLogByTargetKindInput,
  type FindAuditLogForOrganizationInput,
  type AuditLogJsonValue,
  type ListAuditLogEntityHistoryInput,
  type RecordedAuditLogEntry,
  type RecordedSinceInput,
} from "@langwatch/audit-log-contract";
import { generate } from "@langwatch/ksuid";
import { type Instant, Temporal, nowInstant, toDate } from "@langwatch/time";

import type { AuditLogRepository } from "../audit-log.repository.ts";

type MemoryAuditLogRow = AuditLogEntry & {
  id: string;
  createdAt: Instant;
  idempotencyKey?: string;
};

/** Code-unit order, the same order the `id >` watermark uses. */
function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The rows both memory twins share: an entry recorded through one is a touch the other reads. */
export class MemoryAuditLogStore {
  readonly rows: MemoryAuditLogRow[] = [];
}

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

  async findForOrganization(
    input: FindAuditLogForOrganizationInput,
  ): Promise<AuditLogExportEntry[]> {
    const projects = new Set(input.projectIds);
    return this.store.rows
      .filter(
        (row) =>
          row.organizationId === input.organizationId ||
          (row.projectId !== undefined && projects.has(row.projectId)),
      )
      .filter((row) => {
        const at = row.createdAt.epochMilliseconds;
        if (input.untilMs !== undefined && at >= input.untilMs) return false;
        return at > input.afterMs || (at === input.afterMs && row.id > input.afterId);
      })
      .toSorted(
        (left, right) =>
          Temporal.Instant.compare(left.createdAt, right.createdAt) ||
          compareIds(left.id, right.id),
      )
      .slice(0, input.limit)
      .map((row) =>
        auditLogExportEntrySchema.parse({
          id: row.id,
          createdAt: toDate(row.createdAt),
          userId: row.userId ?? null,
          actorUserId: row.actorUserId ?? null,
          organizationId: row.organizationId ?? null,
          projectId: row.projectId ?? null,
          action: row.action,
          error: row.error ?? null,
          ipAddress: row.ipAddress ?? null,
          userAgent: row.userAgent ?? null,
          targetKind: row.targetKind ?? null,
          targetId: row.targetId ?? null,
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
