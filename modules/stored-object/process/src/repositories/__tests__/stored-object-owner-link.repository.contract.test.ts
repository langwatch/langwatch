/**
 * @vitest-environment node
 * The owner-link contract, stated once per backend. Links are keyed by tenant.
 * @see modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryStoredObjectOwnerLinkRepository } from "../memory/memory.stored-object-owner-link.repository.ts";
import type {
  StoredObjectOwnerLink,
  StoredObjectOwnerLinkRepository,
} from "../stored-object-owner-link.repository.ts";

const backends: readonly { name: string; create: () => StoredObjectOwnerLinkRepository }[] = [
  { name: "memory", create: () => MemoryStoredObjectOwnerLinkRepository.create() },
];

const ACME = "project_acme" as StoredObjectProjectId;
const OTHER = "project_other" as StoredObjectProjectId;
const OBJECT = "so_aaaaaaaa" as StoredObjectId;
const AT = Temporal.Instant.from("2026-11-16T00:00:00.000Z");

function day(count: number): Instant {
  return AT.add({ hours: count * 24 });
}

function link(overrides: Partial<StoredObjectOwnerLink> = {}): StoredObjectOwnerLink {
  return {
    tenantId: ACME,
    objectId: OBJECT,
    ownerKind: "trace",
    ownerId: "t1",
    retainUntil: day(30),
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

describe.each(backends)("given the $name stored-object owner-link repository", ({ create }) => {
  describe("when no link is written", () => {
    /** @scenario "The memory and Postgres owner-link repositories answer alike" */
    it("counts no live link", async () => {
      const repository = create();

      await expect(
        repository.countLive({ tenantId: ACME, objectId: OBJECT, now: AT }),
      ).resolves.toBe(0);
    });
  });

  describe("when two owners hold one object", () => {
    /** @scenario "The memory and Postgres owner-link repositories answer alike" */
    it("counts each owner until its own end", async () => {
      const repository = create();
      await repository.raise(link({ ownerId: "t1", retainUntil: day(30) }));
      await repository.raise(link({ ownerId: "t2", retainUntil: day(10) }));

      const live = async (now: Instant) =>
        repository.countLive({ tenantId: ACME, objectId: OBJECT, now });

      await expect(live(day(9))).resolves.toBe(2);
      await expect(live(day(10))).resolves.toBe(1);
      await expect(live(day(30))).resolves.toBe(0);
    });

    /** @scenario "The memory and Postgres owner-link repositories answer alike" */
    it("counts an owner with no end as live", async () => {
      const repository = create();
      await repository.raise(link({ retainUntil: null }));

      await expect(
        repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(10_000) }),
      ).resolves.toBe(1);
    });
  });

  describe("when the same owner is raised again", () => {
    /** @scenario "The memory and Postgres owner-link repositories answer alike" */
    it("moves its end later", async () => {
      const repository = create();
      await repository.raise(link({ retainUntil: day(10) }));

      await repository.raise(link({ retainUntil: day(30), updatedAt: day(1) }));

      await expect(
        repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(29) }),
      ).resolves.toBe(1);
    });

    /** @scenario "The memory and Postgres owner-link repositories answer alike" */
    it("never moves its end earlier", async () => {
      const repository = create();
      await repository.raise(link({ retainUntil: day(30) }));

      await repository.raise(link({ retainUntil: day(10), updatedAt: day(1) }));

      await expect(
        repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(29) }),
      ).resolves.toBe(1);
    });

    /** @scenario "The memory and Postgres owner-link repositories answer alike" */
    it("never gives an owner with no end a date", async () => {
      const repository = create();
      await repository.raise(link({ retainUntil: null }));

      await repository.raise(link({ retainUntil: day(10), updatedAt: day(1) }));

      await expect(
        repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(11) }),
      ).resolves.toBe(1);
    });
  });

  describe("when another project holds a link on the same object id", () => {
    /** @scenario "The memory and Postgres owner-link repositories answer alike" */
    it("neither counts nor deletes the other project's link", async () => {
      const repository = create();
      await repository.raise(link({ tenantId: OTHER }));

      await expect(
        repository.countLive({ tenantId: ACME, objectId: OBJECT, now: AT }),
      ).resolves.toBe(0);

      await repository.raise(link());
      await repository.deleteForTenant({ tenantId: ACME });

      await expect(
        repository.countLive({ tenantId: ACME, objectId: OBJECT, now: AT }),
      ).resolves.toBe(0);
      await expect(
        repository.countLive({ tenantId: OTHER, objectId: OBJECT, now: AT }),
      ).resolves.toBe(1);
    });
  });
});
