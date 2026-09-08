import {
  AuditLogApi,
  type AuditLogApiContract,
  type AuditLogHistoryEntry,
  type ListAuditLogEntityHistoryInput,
  type RecordAuditLogCommand,
} from "@langwatch/audit-log-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { z } from "zod";
import type { AuditLogRepositories } from "../repositories/audit-log.repositories.ts";
import { AuditLogService } from "../services/audit-log.service.ts";

export const auditLogConfigSchema = z.object({
  maxArgsBytes: z
    .number()
    .int()
    .positive()
    .default(4 * 1024),
});
export type AuditLogConfig = z.infer<typeof auditLogConfigSchema>;

type AuditLogSetup = FeatureSetup<
  typeof AuditLogApp.dependencies,
  never,
  AuditLogConfig,
  AuditLogRepositories
>;

export class AuditLogApp implements AuditLogApiContract {
  static readonly contract = AuditLogApi;
  static readonly dependencies = {};
  static readonly configSchema = auditLogConfigSchema;

  readonly #entries: AuditLogService;

  private constructor(entries: AuditLogService) {
    this.#entries = entries;
  }

  static create({ repositories, config }: AuditLogSetup): AuditLogApp {
    return new AuditLogApp(
      AuditLogService.create({
        repository: repositories.entries,
        maxArgsBytes: config.maxArgsBytes,
      }),
    );
  }

  record(command: RecordAuditLogCommand): Promise<void> {
    return this.#entries.record(command);
  }

  listEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]> {
    return this.#entries.listEntityHistory(input);
  }
}
