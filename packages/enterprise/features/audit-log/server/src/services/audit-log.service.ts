import {
  AuditLogService as AuditLogServiceContract,
  recordAuditLogCommandSchema,
  type AuditLogJsonValue,
  type RecordAuditLogCommand,
} from "@langwatch/enterprise-audit-log-contract";
import type { AuditLogRepository } from "../repositories/audit-log.repository";

export type DefaultAuditLogServiceOptions = {
  repository: AuditLogRepository;
  maxArgsBytes?: number;
};

export class DefaultAuditLogService extends AuditLogServiceContract {
  private constructor(
    private readonly repository: AuditLogRepository,
    private readonly maxArgsBytes: number,
  ) {
    super();
  }

  static create(options: DefaultAuditLogServiceOptions): DefaultAuditLogService {
    return new DefaultAuditLogService(options.repository, options.maxArgsBytes ?? 4 * 1024);
  }

  async record(command: RecordAuditLogCommand): Promise<void> {
    const parsed = recordAuditLogCommandSchema.parse(command);
    await this.repository.create({
      ...parsed,
      args:
        parsed.args === undefined
          ? undefined
          : DefaultAuditLogService.boundJson(parsed.args, this.maxArgsBytes),
    });
  }

  private static truncateString(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private static truncateValue(
    value: AuditLogJsonValue,
    maxStringLength: number,
  ): AuditLogJsonValue {
    if (typeof value === "string")
      return DefaultAuditLogService.truncateString(value, maxStringLength);
    if (Array.isArray(value)) {
      return value.map((item) => DefaultAuditLogService.truncateValue(item, maxStringLength));
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          DefaultAuditLogService.truncateValue(item, maxStringLength),
        ]),
      );
    }
    return value;
  }

  private static boundJson(value: AuditLogJsonValue, maxBytes: number): AuditLogJsonValue {
    if (JSON.stringify(value).length <= maxBytes) return value;
    for (const length of [2048, 1024, 512, 256, 128]) {
      const candidate = DefaultAuditLogService.truncateValue(value, length);
      if (JSON.stringify(candidate).length <= maxBytes) return candidate;
    }
    return { "...": "[truncated]" };
  }
}
