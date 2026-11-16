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
const RETIME_PAGE_SIZE = 500;

type StoredObjectRetentionServiceOptions = Readonly<{
  records: StoredObjectRecordRepository;
  ownerLinks: StoredObjectOwnerLinkRepository;
  /** The delete path's provider cleanup; bytes it cannot remove wait for the retry. */
  cleanup: Pick<StoredObjectCleanupService, "deleteStorageBestEffort">;
  now: () => Instant;
  sweepTenantLimit?: number;
  sweepPageSize?: number;
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
   * At most one page of ended links per tenant. Objects go before their links, so a run cut
   * short leaves the ended links for the next run to finish.
   */
  async sweep(): Promise<StoredObjectSweepReport> {
    const now = this.options.now();
    const tenants = await this.options.ownerLinks.findTenantsWithExpired({
      before: now,
      limit: this.options.sweepTenantLimit ?? SWEEP_TENANT_LIMIT,
    });
    let removedLinks = 0;
    let deletedObjects = 0;
    for (const tenantId of tenants) {
      const page = await this.options.ownerLinks.findExpired({
        tenantId,
        before: now,
        limit: this.options.sweepPageSize ?? SWEEP_PAGE_SIZE,
      });
      const objectIds = [...new Set(page.map((link) => link.objectId))];
      for (const id of objectIds) {
        if (await this.#deleteIfUnheld({ tenantId, id, now })) deletedObjects += 1;
      }
      removedLinks += await this.options.ownerLinks.deleteExpired({
        tenantId,
        objectIds,
        before: now,
      });
    }

    return { tenants: tenants.length, removedLinks, deletedObjects };
  }

  /** Whether any purpose follows this retention category, so its facts concern this module. */
  followsCategory({ category }: { category: RetentionCategory }): boolean {
    return purposesIn(category).length > 0;
  }

  /** Each link on the category's objects ends `retentionDays` after it began. */
  async followRetention(input: {
    projectId: StoredObjectProjectId;
    category: RetentionCategory;
    retentionDays: number;
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
          at,
        });
        isFullPage = page.length >= limit;
        afterId = page.at(-1)?.id;
      } while (isFullPage && afterId);
    }
  }

  /** The conditional logical delete, then the delete path's provider cleanup. */
  async #deleteIfUnheld(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
    now: Instant;
  }): Promise<boolean> {
    if (!(await this.options.records.markDeletedIfUnheld(input))) return false;

    const deleted = await this.options.records.findById({ tenantId: input.tenantId, id: input.id });
    if (!deleted?.storage) return true;
    const cleaned = await this.options.cleanup.deleteStorageBestEffort({
      projectId: input.tenantId,
      address: deleted.storage,
    });
    if (cleaned) await this.options.records.upsert({ ...deleted, storage: null });

    return true;
  }
}

function purposesIn(category: RetentionCategory): string[] {
  return Object.entries(STORED_OBJECT_PURPOSES)
    .filter(([, policy]) => policy.retentionCategory === category)
    .map(([purpose]) => purpose);
}
