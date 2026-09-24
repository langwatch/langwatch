import { AnnotationApi } from "@langwatch/annotation-contract";
import {
  AuditLogApi,
  type AuditLogApiContract,
  type AuditLogHistoryEntry,
  type ListAuditLogEntityHistoryInput,
  type RecentItem,
  type RecordAuditLogCommand,
} from "@langwatch/audit-log-contract";
import { DatasetApi } from "@langwatch/dataset-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { MonitorApi } from "@langwatch/monitor-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { PromptApi } from "@langwatch/prompt-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

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
  typeof AuditLogApp.dependencies,
  never,
  undefined,
  AuditLogRepositories
>;

export class AuditLogApp implements AuditLogApiContract, AuditLogHomeApi {
  static readonly contract = AuditLogApi;
  static readonly dependencies = {
    projects: ProjectApi,
    prompts: PromptApi,
    workflows: WorkflowApi,
    datasets: DatasetApi,
    monitors: MonitorApi,
    annotations: AnnotationApi,
  };

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

  static create({ repositories, dependencies }: AuditLogSetup): AuditLogApp {
    return new AuditLogApp({
      entries: AuditLogService.create({
        repository: repositories.entries,
        maxArgsBytes: MAX_ARGS_BYTES,
      }),
      recentItems: RecentItemsService.create({
        touches: repositories.recentTouches,
        owners: dependencies,
      }),
    });
  }

  record(command: RecordAuditLogCommand): Promise<void> {
    return this.#entries.record(command);
  }

  listEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]> {
    return this.#entries.listEntityHistory(input);
  }

  getRecentItems(input: {
    userId: string;
    projectId: string;
    limit: number;
  }): Promise<RecentItem[]> {
    return this.#recentItems.getRecentItems(input);
  }
}
