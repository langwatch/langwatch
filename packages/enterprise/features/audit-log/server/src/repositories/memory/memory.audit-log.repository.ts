import { generate } from "@langwatch/ksuid";
import { Temporal, nowInstant, toDate } from "@langwatch/time";
import type { Instant } from "@langwatch/time";
import {
  auditLogHistoryEntrySchema,
  type AuditLogEntry,
  type AuditLogHistoryEntry,
  type AuditLogJsonValue,
  type ListAuditLogEntityHistoryInput,
} from "@langwatch/audit-log-contract";
import type { AuditLogRepository } from "../audit-log.repository.ts";

type StoredEntry = AuditLogEntry & { id: string; createdAt: Instant };

export class MemoryAuditLogRepository implements AuditLogRepository {
  readonly #rows: StoredEntry[] = [];

  private constructor() {}

  static create(): MemoryAuditLogRepository {
    return new MemoryAuditLogRepository();
  }

  async create(entry: AuditLogEntry): Promise<void> {
    this.#rows.push({ ...entry, id: generate("audit").toString(), createdAt: nowInstant() });
  }

  async findEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]> {
    const matches = this.#rows
      .filter((row) => matchesEntity(row, input))
      .sort((left, right) => Temporal.Instant.compare(right.createdAt, left.createdAt))
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
}

function matchesEntity(row: StoredEntry, input: ListAuditLogEntityHistoryInput): boolean {
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
