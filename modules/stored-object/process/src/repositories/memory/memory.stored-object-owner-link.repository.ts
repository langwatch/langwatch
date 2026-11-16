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
    return this.#live(input).length;
  }

  /** Whether any owner holds the object at `now`; synchronous, so a twin delete is one step. */
  holds(input: {
    tenantId: StoredObjectProjectId;
    objectId: StoredObjectId;
    now: Instant;
  }): boolean {
    return this.#live(input).length > 0;
  }

  async deleteForTenant(input: { tenantId: StoredObjectProjectId }): Promise<void> {
    for (const [linkKey, link] of this.#links) {
      if (link.tenantId === input.tenantId) this.#links.delete(linkKey);
    }
  }

  async findTenantsWithExpired(input: {
    before: Instant;
    limit: number;
  }): Promise<StoredObjectProjectId[]> {
    const tenants = new Set(
      [...this.#links.values()]
        .filter((link) => hasEndedBy({ link, before: input.before }))
        .map((link) => link.tenantId),
    );

    return [...tenants].toSorted().slice(0, input.limit);
  }

  async findExpired(input: {
    tenantId: StoredObjectProjectId;
    before: Instant;
    limit: number;
  }): Promise<StoredObjectOwnerLink[]> {
    return [...this.#links.values()]
      .filter(
        (link) => link.tenantId === input.tenantId && hasEndedBy({ link, before: input.before }),
      )
      .toSorted(
        (left, right) =>
          left.objectId.localeCompare(right.objectId) ||
          left.ownerKind.localeCompare(right.ownerKind) ||
          left.ownerId.localeCompare(right.ownerId),
      )
      .slice(0, input.limit);
  }

  async deleteExpired(input: {
    tenantId: StoredObjectProjectId;
    objectIds: readonly StoredObjectId[];
    before: Instant;
  }): Promise<number> {
    let deleted = 0;
    for (const [linkKey, link] of this.#links) {
      if (
        link.tenantId === input.tenantId &&
        input.objectIds.includes(link.objectId) &&
        hasEndedBy({ link, before: input.before })
      ) {
        this.#links.delete(linkKey);
        deleted += 1;
      }
    }

    return deleted;
  }

  async retime(input: {
    tenantId: StoredObjectProjectId;
    objectIds: readonly StoredObjectId[];
    days: number | null;
    at: Instant;
  }): Promise<void> {
    for (const [linkKey, link] of this.#links) {
      if (link.tenantId !== input.tenantId || !input.objectIds.includes(link.objectId)) continue;
      this.#links.set(linkKey, {
        ...link,
        retainUntil: input.days === null ? null : link.createdAt.add({ hours: input.days * 24 }),
        updatedAt: input.at,
      });
    }
  }

  #live(input: {
    tenantId: StoredObjectProjectId;
    objectId: StoredObjectId;
    now: Instant;
  }): StoredObjectOwnerLink[] {
    return [...this.#links.values()].filter(
      (link) =>
        link.tenantId === input.tenantId &&
        link.objectId === input.objectId &&
        (link.retainUntil === null || Temporal.Instant.compare(link.retainUntil, input.now) > 0),
    );
  }
}

/** A link with no end never ends; a dated one has ended once its end is at or before `before`. */
function hasEndedBy({ link, before }: { link: StoredObjectOwnerLink; before: Instant }): boolean {
  return link.retainUntil !== null && Temporal.Instant.compare(link.retainUntil, before) <= 0;
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
