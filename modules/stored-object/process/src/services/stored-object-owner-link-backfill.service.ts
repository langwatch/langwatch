import { INDEFINITE_RETENTION_DAYS } from "@langwatch/data-retention-contract";
import {
  STORED_OBJECT_PURPOSES,
  storedObjectProjectIdSchema,
} from "@langwatch/stored-object-contract";
import type { TenantMigrationOutcome } from "@langwatch/system-migrations";
import { type Instant, nowInstant } from "@langwatch/time";
import { defineMigrationStep, type TenantMigrationStep } from "@langwatch/upgrade/step";

import type { StoredObjectOwnerLinkRepository } from "../repositories/stored-object-owner-link.repository.ts";
import type { StoredObjectRecordRepository } from "../repositories/stored-object-record.repository.ts";
import type { StoredObjectRetention } from "./stored-object-upload.service.ts";

type StoredObjectOwnerLinkBackfillServiceOptions = Readonly<{
  records: StoredObjectRecordRepository;
  ownerLinks: StoredObjectOwnerLinkRepository;
  retention: StoredObjectRetention;
  pageSize?: number;
  now?: () => Instant;
}>;

/**
 * Links each object stored before owner links existed to the owner that stored it, until its
 * category's retention ends counted from the object's creation (ADR-002 §2, §3). Before reuse,
 * every store minted its own object, so the recorded owner is the only one that holds it.
 */
export class StoredObjectOwnerLinkBackfillService {
  static create(
    options: StoredObjectOwnerLinkBackfillServiceOptions,
  ): StoredObjectOwnerLinkBackfillService {
    return new StoredObjectOwnerLinkBackfillService(options);
  }

  private readonly now: () => Instant;

  private constructor(private readonly options: StoredObjectOwnerLinkBackfillServiceOptions) {
    this.now = options.now ?? nowInstant;
  }

  /** Waits until no old image serves: an old image stores retained purposes without a link. */
  step(): TenantMigrationStep {
    return defineMigrationStep({
      id: "stored-object:link-unowned-retained-objects",
      kind: "tenant",
      mode: "background",
      tenants: "project",
      needsOldWritersGone: true,
      title: "Stored Objects owner links for media stored before them",
      description:
        "Links audio and images stored from traces before owner links existed to their trace, so they are deleted with it.",
      requiresOperatorConfirmation: false,
      runsAutomaticallyOnSelfHosted: true,
      enrolledAutomatically: true,
      migrateTenant: (args) => this.migrateTenant(args),
    });
  }

  async migrateTenant({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const projectId = storedObjectProjectIdSchema.parse(tenantId);
    const counts = { scanned: 0, linked: 0 };
    for (const [purpose, policy] of Object.entries(STORED_OBJECT_PURPOSES)) {
      if (!policy.retentionCategory) continue;
      const days = await this.options.retention.getRetentionDays({
        projectId,
        category: policy.retentionCategory,
      });
      const page = await this.linkPurpose({ projectId, purpose, days, signal });
      counts.scanned += page.scanned;
      counts.linked += page.linked;
    }

    return {
      status: "finalized",
      report: { kind: "stored_object_owner_links_backfilled", ...counts },
    };
  }

  private async linkPurpose({
    projectId,
    purpose,
    days,
    signal,
  }: {
    projectId: ReturnType<typeof storedObjectProjectIdSchema.parse>;
    purpose: string;
    days: number;
    signal?: AbortSignal | undefined;
  }): Promise<{ scanned: number; linked: number }> {
    const counts = { scanned: 0, linked: 0 };
    const limit = this.options.pageSize ?? 250;
    let afterId: string | undefined;
    let isFullPage: boolean;
    do {
      const page = await this.options.records.findPage({
        tenantId: projectId,
        purpose,
        status: "available",
        limit,
        ...(afterId ? { afterId } : {}),
      });
      for (const record of page) {
        this.assertActive(signal);
        counts.scanned += 1;
        const links = await this.options.ownerLinks.countAll({
          tenantId: projectId,
          objectId: record.id,
        });
        if (links > 0) continue;
        await this.options.ownerLinks.raise({
          tenantId: projectId,
          objectId: record.id,
          ownerKind: record.ownerKind,
          ownerId: record.ownerId,
          // Indefinite retention holds with no end; `createdAt + 0` would end it at once.
          retainUntil:
            days === INDEFINITE_RETENTION_DAYS ? null : record.createdAt.add({ hours: days * 24 }),
          createdAt: record.createdAt,
          updatedAt: this.now(),
        });
        counts.linked += 1;
      }
      isFullPage = page.length >= limit;
      afterId = page.at(-1)?.id;
    } while (isFullPage && afterId);

    return counts;
  }

  private assertActive(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Stored Objects owner link backfill aborted");
    }
  }
}
