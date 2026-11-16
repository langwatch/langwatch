import { PrismaRepository } from "@langwatch/prisma-client";
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, toDate } from "@langwatch/time";

import type {
  StoredObjectOwnerLink,
  StoredObjectOwnerLinkRepository,
} from "../stored-object-owner-link.repository.ts";

export class PrismaStoredObjectOwnerLinkRepository
  extends PrismaRepository.for("StoredObjectOwner")
  implements StoredObjectOwnerLinkRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaStoredObjectOwnerLinkRepository(prisma),
  );

  /**
   * An insert that skips an existing key, then a raise conditional on the
   * stored end being earlier: each statement is atomic, so concurrent raises
   * settle on the latest end and none lowers another.
   */
  async raise(link: StoredObjectOwnerLink): Promise<void> {
    const retainUntil = link.retainUntil ? toDate(link.retainUntil) : null;
    const { count } = await this.prisma.storedObjectOwner.createMany({
      data: [
        {
          tenantId: link.tenantId,
          objectId: link.objectId,
          ownerKind: link.ownerKind,
          ownerId: link.ownerId,
          retainUntil,
          createdAt: toDate(link.createdAt),
          updatedAt: toDate(link.updatedAt),
        },
      ],
      skipDuplicates: true,
    });
    if (count > 0) return;

    await this.prisma.storedObjectOwner.updateMany({
      where: {
        tenantId: link.tenantId,
        objectId: link.objectId,
        ownerKind: link.ownerKind,
        ownerId: link.ownerId,
        retainUntil: retainUntil === null ? { not: null } : { lt: retainUntil },
      },
      data: { retainUntil, updatedAt: toDate(link.updatedAt) },
    });
  }

  async countLive(input: {
    tenantId: StoredObjectProjectId;
    objectId: StoredObjectId;
    now: Instant;
  }): Promise<number> {
    return this.prisma.storedObjectOwner.count({
      where: {
        tenantId: input.tenantId,
        objectId: input.objectId,
        OR: [{ retainUntil: null }, { retainUntil: { gt: toDate(input.now) } }],
      },
    });
  }

  async deleteForTenant(input: { tenantId: StoredObjectProjectId }): Promise<void> {
    await this.prisma.storedObjectOwner.deleteMany({ where: { tenantId: input.tenantId } });
  }
}
