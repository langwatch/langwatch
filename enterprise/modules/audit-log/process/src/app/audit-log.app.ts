import {
  AuditLogApi,
  type AuditLogApiContract,
  type AuditLogHistoryEntry,
  type ListAuditLogEntityHistoryInput,
  type RecordAuditLogCommand,
} from "@langwatch/audit-log-contract";
import type { FeatureSetup } from "@langwatch/kernel";

import type { AuditLogRepositories } from "../repositories/audit-log.repositories.ts";
import { AuditLogService } from "../services/audit-log.service.ts";

/**
 * No deployment ever fed this through the (now-deleted) app config — the
 * schema's own default was the only value it ever took. Ported as the
 * literal it always resolved to rather than minting a new env spelling.
 */
const MAX_ARGS_BYTES = 4 * 1024;

type AuditLogSetup = FeatureSetup<
  typeof AuditLogApp.dependencies,
  never,
  undefined,
  AuditLogRepositories
>;

export class AuditLogApp implements AuditLogApiContract {
  static readonly contract = AuditLogApi;
  static readonly dependencies = {};

  readonly #entries: AuditLogService;

  private constructor(entries: AuditLogService) {
    this.#entries = entries;
  }

  static create({ repositories }: AuditLogSetup): AuditLogApp {
    return new AuditLogApp(
      AuditLogService.create({
        repository: repositories.entries,
        maxArgsBytes: MAX_ARGS_BYTES,
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
