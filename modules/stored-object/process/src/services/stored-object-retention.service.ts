import {
  INDEFINITE_RETENTION_DAYS,
  type RetentionCategory,
} from "@langwatch/data-retention-contract";
import {
  STORED_OBJECT_PURPOSES,
  type StoredObjectId,
  type StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

import type { StoredObjectOwnerLinkRepository } from "../repositories/stored-object-owner-link.repository.ts";
import type { StoredObjectRecordRepository } from "../repositories/stored-object-record.repository.ts";
import type { StoredObjectCleanupService } from "./stored-object-cleanup.service.ts";

const SWEEP_TENANT_LIMIT = 100;
const SWEEP_PAGE_SIZE = 500;
/** Below the sweep intent's 30-minute lease, so a run ends before another may start. */
const SWEEP_BUDGET_MS = 20 * 60 * 1000;
const RETIME_PAGE_SIZE = 500;

type StoredObjectRetentionServiceOptions = Readonly<{
  records: StoredObjectRecordRepository;
  ownerLinks: StoredObjectOwnerLinkRepository;
  /** The delete path's provider cleanup; bytes it cannot remove wait for the reaper's retry. */
  cleanup: Pick<StoredObjectCleanupService, "removeBytesOf">;
  now: () => Instant;
  sweepTenantLimit?: number;
  sweepPageSize?: number;
  sweepBudgetMs?: number;
  retimePageSize?: number;
}>;

export type StoredObjectSweepReport = Readonly<{
  tenants: number;
  removedLinks: number;
  deletedObjects: number;
}>;

/**
 * Owner-linked retention (ADR-002 §4, §5): the sweep removes ended links and deletes each
 * object no live link still holds; a retroactive retention change re-times a project's
 * links. Pins are not consulted, matching data-retention.
 */
export class StoredObjectRetentionService {
  static create(options: StoredObjectRetentionServiceOptions): StoredObjectRetentionService {
    return new StoredObjectRetentionService(options);
  }

  private constructor(private readonly options: StoredObjectRetentionServiceOptions) {}

  /**
   * One page from each tenant in turn until none is left or the budget ends. Objects go
   * before their links, so a run cut short leaves the ended links for the next run. A
   * failing tenant leaves the turn; the run throws its failures once the others are done.
   */
  async sweep(): Promise<StoredObjectSweepReport> {
    const startedAt = this.options.now();
    const budgetMs = this.options.sweepBudgetMs ?? SWEEP_BUDGET_MS;
    const pageSize = this.options.sweepPageSize ?? SWEEP_PAGE_SIZE;
    const tenants = await this.options.ownerLinks.findTenantsWithExpired({
      before: startedAt,
      limit: this.options.sweepTenantLimit ?? SWEEP_TENANT_LIMIT,
    });
    const tally = { removedLinks: 0, deletedObjects: 0, failures: [] as unknown[] };
    let turn = tenants;
    while (turn.length > 0) {
      turn = await this.#sweepTurn({ tenants: turn, startedAt, budgetMs, pageSize, tally });
    }
    const { removedLinks, deletedObjects, failures } = tally;
    if (failures.length > 0) {
      throw new AggregateError(failures, `The sweep failed for ${failures.length} tenant(s)`);
    }

    return { tenants: tenants.length, removedLinks, deletedObjects };
  }

  /** Whether any purpose follows this retention category, so its facts concern this module. */
  followsCategory({ category }: { category: RetentionCategory }): boolean {
    return purposesIn(category).length > 0;
  }

  /**
   * Each link on the category's objects ends `retentionDays` after it began. A raise only
   * lengthened the rows, so it moves a link's end later and never earlier.
   */
  async followRetention(input: {
    projectId: StoredObjectProjectId;
    category: RetentionCategory;
    retentionDays: number;
    isRaise?: boolean;
  }): Promise<void> {
    const days = input.retentionDays === INDEFINITE_RETENTION_DAYS ? null : input.retentionDays;
    const limit = this.options.retimePageSize ?? RETIME_PAGE_SIZE;
    const at = this.options.now();
    for (const purpose of purposesIn(input.category)) {
      let afterId: StoredObjectId | undefined;
      let isFullPage: boolean;
      do {
        const page = await this.options.records.findPage({
          tenantId: input.projectId,
          purpose,
          limit,
          ...(afterId ? { afterId } : {}),
        });
        await this.options.ownerLinks.retime({
          tenantId: input.projectId,
          objectIds: page.map((value) => value.id),
          days,
          onlyLater: input.isRaise === true,
          at,
        });
        isFullPage = page.length >= limit;
        afterId = page.at(-1)?.id;
      } while (isFullPage && afterId);
    }
  }

  /** One page from each tenant; answers the tenants with more to take, none once over budget. */
  async #sweepTurn(input: {
    tenants: readonly StoredObjectProjectId[];
    startedAt: Instant;
    budgetMs: number;
    pageSize: number;
    tally: { removedLinks: number; deletedObjects: number; failures: unknown[] };
  }): Promise<StoredObjectProjectId[]> {
    const { startedAt, budgetMs, pageSize, tally } = input;
    const next: StoredObjectProjectId[] = [];
    for (const tenantId of input.tenants) {
      if (this.#elapsedMs(startedAt) >= budgetMs) return [];
      try {
        const page = await this.#sweepPage({ tenantId, now: startedAt, pageSize });
        tally.removedLinks += page.removedLinks;
        tally.deletedObjects += page.deletedObjects;
        if (page.isFull && page.removedLinks > 0) next.push(tenantId);
      } catch (error) {
        tally.failures.push(error);
      }
    }

    return this.#elapsedMs(startedAt) >= budgetMs ? [] : next;
  }

  async #sweepPage(input: {
    tenantId: StoredObjectProjectId;
    now: Instant;
    pageSize: number;
  }): Promise<{ removedLinks: number; deletedObjects: number; isFull: boolean }> {
    const page = await this.options.ownerLinks.findExpired({
      tenantId: input.tenantId,
      before: input.now,
      limit: input.pageSize,
    });
    const objectIds = [...new Set(page.map((link) => link.objectId))];
    const held: StoredObjectId[] = [];
    for (const id of objectIds) {
      if (!(await this.#deleteIfUnheld({ tenantId: input.tenantId, id, now: input.now }))) {
        held.push(id);
      }
    }
    const removedLinks = await this.options.ownerLinks.deleteExpired({
      tenantId: input.tenantId,
      objectIds,
      before: input.now,
    });
    // A retime between the check and the delete can end a held object's last link: ask again.
    let deletedObjects = objectIds.length - held.length;
    for (const id of held) {
      if (await this.#deleteIfUnheld({ tenantId: input.tenantId, id, now: input.now })) {
        deletedObjects += 1;
      }
    }

    return { removedLinks, deletedObjects, isFull: page.length >= input.pageSize };
  }

  #elapsedMs(startedAt: Instant): number {
    return this.options.now().epochMilliseconds - startedAt.epochMilliseconds;
  }

  /**
   * The conditional logical delete, then the delete path's provider cleanup. The delete
   * expires the row, so bytes a refused provider delete leaves wait for the upload reaper.
   */
  async #deleteIfUnheld(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
    now: Instant;
  }): Promise<boolean> {
    if (!(await this.options.records.markDeletedIfUnheld(input))) return false;

    const deleted = await this.options.records.findById({ tenantId: input.tenantId, id: input.id });
    if (deleted?.status === "deleted") await this.options.cleanup.removeBytesOf(deleted);

    return true;
  }
}

function purposesIn(category: RetentionCategory): string[] {
  return Object.entries(STORED_OBJECT_PURPOSES)
    .filter(([, policy]) => policy.retentionCategory === category)
    .map(([purpose]) => purpose);
}
