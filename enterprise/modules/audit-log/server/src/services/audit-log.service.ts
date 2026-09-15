import {
  recordAuditLogCommandSchema,
  type AuditLogHistoryEntry,
  type AuditLogJsonValue,
  type ListAuditLogEntityHistoryInput,
  type RecordAuditLogCommand,
} from "@langwatch/audit-log-contract";
import type { AuditLogRepository } from "../repositories/audit-log.repository.ts";

const TRUNCATION_LENGTHS = [2048, 1024, 512, 256, 128] as const;

export class AuditLogService {
  private constructor(
    private readonly repository: AuditLogRepository,
    private readonly maxArgsBytes: number,
  ) {}

  static create({
    repository,
    maxArgsBytes,
  }: {
    repository: AuditLogRepository;
    maxArgsBytes: number;
  }): AuditLogService {
    return new AuditLogService(repository, maxArgsBytes);
  }

  async record(command: RecordAuditLogCommand): Promise<void> {
    const parsed = recordAuditLogCommandSchema.parse(command);
    await this.repository.create({
      ...parsed,
      args:
        parsed.args === undefined
          ? undefined
          : AuditLogService.boundJson(parsed.args, this.maxArgsBytes),
    });
  }

  listEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]> {
    return this.repository.findEntityHistory(input);
  }

  private static truncateString(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private static truncateValue(
    value: AuditLogJsonValue,
    maxStringLength: number,
  ): AuditLogJsonValue {
    if (typeof value === "string") {
      return AuditLogService.truncateString(value, maxStringLength);
    }

    if (Array.isArray(value)) {
      return value.map((item) => AuditLogService.truncateValue(item, maxStringLength));
    }

    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          AuditLogService.truncateValue(item, maxStringLength),
        ]),
      );
    }

    return value;
  }

  private static boundJson(value: AuditLogJsonValue, maxBytes: number): AuditLogJsonValue {
    if (JSON.stringify(value).length <= maxBytes) {
      return value;
    }

    for (const length of TRUNCATION_LENGTHS) {
      const candidate = AuditLogService.truncateValue(value, length);
      if (JSON.stringify(candidate).length <= maxBytes) {
        return candidate;
      }
    }

    return { "...": "[truncated]" };
  }
}
