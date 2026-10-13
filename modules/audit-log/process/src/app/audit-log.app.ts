import {
  AuditLogApi,
  type AuditLogHistoryEntry,
  type AuditLogTargetEntry,
  type FindAuditLogByTargetKindInput,
  type ListAuditLogEntityHistoryInput,
  type RecentItem,
  type RecordAuditLogCommand,
  type RecordedAuditLogEntry,
  type RecordedSinceInput,
} from "@langwatch/audit-log-contract";
import type { FeatureSetup } from "@langwatch/process";

import { type AuditLogPipeline, buildAuditLogPipeline } from "../eventing/audit-log.pipeline.ts";
import type { AuditLogRepositories } from "../repositories/audit-log.repositories.ts";
import { AuditLogService } from "../services/audit-log.service.ts";
import { RecentItemsService } from "../services/recent-items.service.ts";
import type { AuditLogHomeApi } from "../transport/home.trpc.ts";

/**
 * No deployment ever fed this through the (now-deleted) app config — the
 * schema's own default was the only value it ever took. Ported as the
 * literal it always resolved to rather than minting a new env spelling.
 */
const MAX_ARGS_BYTES = 4 * 1024;

type AuditLogSetup = FeatureSetup<
  typeof AuditLogModule.dependencies,
  undefined,
  AuditLogRepositories
>;

export class AuditLogModule implements AuditLogApi, AuditLogHomeApi {
  static readonly contract = AuditLogApi;
  static readonly dependencies = {};

  readonly #entries: AuditLogService;
  readonly #recentItems: RecentItemsService;

  private constructor({
    entries,
    recentItems,
  }: {
    entries: AuditLogService;
    recentItems: RecentItemsService;
  }) {
    this.#entries = entries;
    this.#recentItems = recentItems;
  }

  static create({ repositories }: AuditLogSetup): AuditLogModule {
    return new AuditLogModule({
      entries: AuditLogService.create({
        repository: repositories.entries,
        maxArgsBytes: MAX_ARGS_BYTES,
      }),
      recentItems: RecentItemsService.create({ touches: repositories.recentTouches }),
    });
  }

  /** The pipeline whose peer subscribers write organization's audit facts as rows. */
  factsPipeline(): AuditLogPipeline {
    return buildAuditLogPipeline({ entries: this.#entries });
  }

  record(command: RecordAuditLogCommand): Promise<RecordedAuditLogEntry> {
    return this.#entries.record(command);
  }

  hasRecordedSince(input: RecordedSinceInput): Promise<boolean> {
    return this.#entries.hasRecordedSince(input);
  }

  listEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]> {
    return this.#entries.listEntityHistory(input);
  }

  findByTargetKind(input: FindAuditLogByTargetKindInput): Promise<AuditLogTargetEntry[]> {
    return this.#entries.findByTargetKind(input);
  }

  getRecentItems(input: {
    userId: string;
    projectId: string;
    limit: number;
  }): Promise<RecentItem[]> {
    return this.#recentItems.getRecentItems(input);
  }
}
