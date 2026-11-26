import { INDEFINITE_RETENTION_DAYS } from "@langwatch/data-retention-contract";
import {
  type LinkUnownedStoredObjectsInput,
  type LinkUnownedStoredObjectsResult,
  purposePolicyOf,
  storedObjectProjectIdSchema,
} from "@langwatch/stored-object-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type { StoredObjectOwnerLinkRepository } from "../repositories/stored-object-owner-link.repository.ts";
import type { StoredObjectRecordRepository } from "../repositories/stored-object-record.repository.ts";

type StoredObjectOwnerLinkBackfillServiceOptions = Readonly<{
  records: StoredObjectRecordRepository;
  ownerLinks: StoredObjectOwnerLinkRepository;
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

  /** Objects that already hold a link are left alone, so a second run links nothing. */
  async linkUnowned(input: LinkUnownedStoredObjectsInput): Promise<LinkUnownedStoredObjectsResult> {
    if (purposePolicyOf(input.purpose).retentionCategory === undefined) {
      throw new Error(`purpose ${input.purpose} follows no retention category`);
    }
    const projectId = storedObjectProjectIdSchema.parse(input.projectId);
    const days = input.retentionDays;
    const counts = { scanned: 0, linked: 0 };
    const limit = this.options.pageSize ?? 250;
    let afterId: string | undefined;
    let isFullPage: boolean;
    do {
      const page = await this.options.records.findPage({
        tenantId: projectId,
        purpose: input.purpose,
        status: "available",
        limit,
        ...(afterId ? { afterId } : {}),
      });
      for (const record of page) {
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
}
