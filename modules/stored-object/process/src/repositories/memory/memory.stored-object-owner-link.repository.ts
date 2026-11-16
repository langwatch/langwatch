import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";

import type {
  StoredObjectOwnerLink,
  StoredObjectOwnerLinkRepository,
} from "../stored-object-owner-link.repository.ts";

/** The same answers as the Prisma repository, over one Map keyed by the link's four-part key. */
export class MemoryStoredObjectOwnerLinkRepository implements StoredObjectOwnerLinkRepository {
  static create(): MemoryStoredObjectOwnerLinkRepository {
    return new MemoryStoredObjectOwnerLinkRepository();
  }

  readonly #links = new Map<string, StoredObjectOwnerLink>();

  private constructor() {}

  async raise(link: StoredObjectOwnerLink): Promise<void> {
    const existing = this.#links.get(key(link));
    if (!existing) {
      this.#links.set(key(link), link);
      return;
    }
    if (isLater({ candidate: link.retainUntil, than: existing.retainUntil })) {
      this.#links.set(key(link), {
        ...existing,
        retainUntil: link.retainUntil,
        updatedAt: link.updatedAt,
      });
    }
  }

  async countLive(input: {
    tenantId: StoredObjectProjectId;
    objectId: StoredObjectId;
    now: Instant;
  }): Promise<number> {
    return [...this.#links.values()].filter(
      (link) =>
        link.tenantId === input.tenantId &&
        link.objectId === input.objectId &&
        (link.retainUntil === null || Temporal.Instant.compare(link.retainUntil, input.now) > 0),
    ).length;
  }

  async deleteForTenant(input: { tenantId: StoredObjectProjectId }): Promise<void> {
    for (const [linkKey, link] of this.#links) {
      if (link.tenantId === input.tenantId) this.#links.delete(linkKey);
    }
  }
}

/** A link with no end outlasts any dated one; between two dates, the later wins. */
function isLater({
  candidate,
  than,
}: {
  candidate: Instant | null;
  than: Instant | null;
}): boolean {
  if (than === null) return false;
  if (candidate === null) return true;

  return Temporal.Instant.compare(candidate, than) > 0;
}

function key(link: {
  tenantId: string;
  objectId: string;
  ownerKind: string;
  ownerId: string;
}): string {
  return JSON.stringify([link.tenantId, link.objectId, link.ownerKind, link.ownerId]);
}
