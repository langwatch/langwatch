/**
 * @vitest-environment node
 * The owner-link contract, stated once per backend. Links are keyed by tenant.
 * @see modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryStoredObjectOwnerLinkRepository } from "../memory/memory.stored-object-owner-link.repository.ts";
import { PrismaStoredObjectOwnerLinkRepository } from "../prisma/prisma.stored-object-owner-link.repository.ts";
import type {
  StoredObjectOwnerLink,
  StoredObjectOwnerLinkRepository,
} from "../stored-object-owner-link.repository.ts";
import { emptyTenants, findPrismaTestClients } from "./support/prisma-test-database.support.ts";

const backends: readonly {
  name: string;
  create: () => StoredObjectOwnerLinkRepository;
  reset: () => Promise<void>;
}[] = [
  {
    name: "memory",
    create: () => MemoryStoredObjectOwnerLinkRepository.create(),
    reset: async () => {},
  },
  ...findPrismaTestClients().map((prisma) => ({
    name: "Postgres",
    create: () => PrismaStoredObjectOwnerLinkRepository.create({ prisma }),
    reset: () => emptyTenants({ prisma, tenantIds: [ACME, OTHER] }),
  })),
];

const ACME = "project_acme_links" as StoredObjectProjectId;
const OTHER = "project_other_links" as StoredObjectProjectId;
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

describe.each(backends)(
  "given the $name stored-object owner-link repository",
  ({ create, reset }) => {
    beforeEach(reset);

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

      /** @scenario "A re-time counts from the owner's latest store" */
      it("moves its start with its end, so a re-time counts from the latest store", async () => {
        const repository = create();
        await repository.raise(link({ retainUntil: day(30) }));
        await repository.raise(link({ retainUntil: day(50), createdAt: day(20) }));

        await repository.retime({ tenantId: ACME, objectIds: [OBJECT], days: 7, at: day(21) });

        await expect(
          repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(26) }),
        ).resolves.toBe(1);
        await expect(
          repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(27) }),
        ).resolves.toBe(0);
      });

      /** @scenario "A re-time counts from the owner's latest store" */
      it("moves its start to the latest store when stored again with no end", async () => {
        const repository = create();
        await repository.raise(link({ retainUntil: null }));
        await repository.raise(link({ retainUntil: null, createdAt: day(20) }));

        await repository.retime({ tenantId: ACME, objectIds: [OBJECT], days: 7, at: day(21) });

        await expect(
          repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(26) }),
        ).resolves.toBe(1);
        await expect(
          repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(27) }),
        ).resolves.toBe(0);
      });

      /** @scenario "An object stored before owner links is never reused for a retained purpose" */
      it("counts every link ever written, ended or not, and none for another tenant", async () => {
        const repository = create();
        await repository.raise(link({ ownerId: "t1", retainUntil: day(1) }));
        await repository.raise(link({ ownerId: "t2", retainUntil: day(30) }));

        await expect(repository.countAll({ tenantId: ACME, objectId: OBJECT })).resolves.toBe(2);
        await expect(repository.countAll({ tenantId: OTHER, objectId: OBJECT })).resolves.toBe(0);
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

    describe("when links end before, at and after the sweep's instant", () => {
      const SECOND = "so_bbbbbbbb" as StoredObjectId;

      /** @scenario "The memory and Postgres owner-link repositories answer alike" */
      it("pages ended links by object and owner, and lists tenants holding one", async () => {
        const repository = create();
        await repository.raise(link({ objectId: SECOND, ownerId: "t2", retainUntil: day(1) }));
        await repository.raise(link({ ownerId: "t3", retainUntil: day(2) }));
        await repository.raise(link({ ownerId: "t1", retainUntil: day(2) }));
        await repository.raise(link({ ownerId: "t4", retainUntil: day(3) }));
        await repository.raise(link({ ownerId: "forever", retainUntil: null }));
        await repository.raise(link({ tenantId: OTHER, retainUntil: day(1) }));

        const page = await repository.findExpired({ tenantId: ACME, before: day(2), limit: 10 });
        expect(page.map((value) => [value.objectId, value.ownerId])).toEqual([
          [OBJECT, "t1"],
          [OBJECT, "t3"],
          [SECOND, "t2"],
        ]);
        await expect(
          repository.findExpired({ tenantId: ACME, before: day(2), limit: 1 }),
        ).resolves.toHaveLength(1);
        // Other suites share the test database: assert this suite's tenants, not the whole list.
        const ended = await repository.findTenantsWithExpired({ before: day(2), limit: 10_000 });
        expect(ended).toEqual(expect.arrayContaining([ACME, OTHER]));
        const none = await repository.findTenantsWithExpired({ before: day(0), limit: 10_000 });
        expect(none).not.toContain(ACME);
        expect(none).not.toContain(OTHER);
      });

      /** @scenario "The memory and Postgres owner-link repositories answer alike" */
      it("deletes only links still ended, and only the tenant's own", async () => {
        const repository = create();
        await repository.raise(link({ ownerId: "t1", retainUntil: day(1) }));
        await repository.raise(link({ ownerId: "t2", retainUntil: day(1) }));
        await repository.raise(link({ ownerId: "t2", retainUntil: day(9) }));
        await repository.raise(link({ tenantId: OTHER, retainUntil: day(1) }));

        await expect(
          repository.deleteExpired({ tenantId: ACME, objectIds: [OBJECT], before: day(2) }),
        ).resolves.toBe(1);
        await expect(
          repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(2) }),
        ).resolves.toBe(1);
        const ended = await repository.findTenantsWithExpired({ before: day(2), limit: 10_000 });
        expect(ended).toContain(OTHER);
        expect(ended).not.toContain(ACME);
      });

      /** @scenario "A re-time during the sweep still lets the sweep delete the object" */
      it("keeps every ended link of an object no live link holds when asked to keep the last", async () => {
        const repository = create();
        const SECOND = "so_cccccccc" as StoredObjectId;
        await repository.raise(link({ ownerId: "t1", retainUntil: day(1) }));
        await repository.raise(link({ ownerId: "t2", retainUntil: day(9) }));
        await repository.raise(link({ objectId: SECOND, ownerId: "t1", retainUntil: day(1) }));

        await expect(
          repository.deleteExpired({
            tenantId: ACME,
            objectIds: [OBJECT, SECOND],
            before: day(2),
            keepingLastLink: true,
          }),
        ).resolves.toBe(1);
        const left = await repository.findExpired({ tenantId: ACME, before: day(100), limit: 10 });
        expect(left.map((value) => [value.objectId, value.ownerId])).toEqual([
          [OBJECT, "t2"],
          [SECOND, "t1"],
        ]);
      });

      /** @scenario "The sweep's tenant list starts with the longest-waiting ended link" */
      it("lists the tenant whose ended link waited longest first, whatever its id", async () => {
        const repository = create();
        await repository.raise(link({ ownerId: "t1", retainUntil: day(2) }));
        await repository.raise(link({ tenantId: OTHER, retainUntil: day(1) }));

        const ended = await repository.findTenantsWithExpired({ before: day(3), limit: 10_000 });

        expect(ended.indexOf(OTHER)).toBeGreaterThanOrEqual(0);
        expect(ended.indexOf(OTHER)).toBeLessThan(ended.indexOf(ACME));
      });
    });

    describe("when a project's links are re-timed", () => {
      /** @scenario "The memory and Postgres owner-link repositories answer alike" */
      it("sets each to its createdAt plus the days, or to no end, and leaves other projects alone", async () => {
        const repository = create();
        await repository.raise(link({ ownerId: "t1", createdAt: day(1), retainUntil: day(31) }));
        await repository.raise(link({ tenantId: OTHER, retainUntil: day(30) }));

        await repository.retime({ tenantId: ACME, objectIds: [OBJECT], days: 7, at: day(2) });
        await expect(
          repository.findExpired({ tenantId: ACME, before: day(8), limit: 10 }),
        ).resolves.toEqual([
          expect.objectContaining({ ownerId: "t1", retainUntil: day(8), updatedAt: day(2) }),
        ]);

        await repository.retime({ tenantId: ACME, objectIds: [OBJECT], days: null, at: day(3) });
        await expect(
          repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(10_000) }),
        ).resolves.toBe(1);
        await expect(
          repository.findExpired({ tenantId: OTHER, before: day(30), limit: 10 }),
        ).resolves.toHaveLength(1);
      });

      /** @scenario "A raise never shortens a media link" */
      it("moves only earlier ends later when asked for later only", async () => {
        const repository = create();
        await repository.raise(link({ ownerId: "short", retainUntil: day(7) }));
        await repository.raise(link({ ownerId: "long", retainUntil: day(90) }));
        await repository.raise(link({ ownerId: "forever", retainUntil: null }));

        await repository.retime({
          tenantId: ACME,
          objectIds: [OBJECT],
          days: 30,
          onlyLater: true,
          at: day(2),
        });

        const ends = await repository.findExpired({ tenantId: ACME, before: day(100), limit: 10 });
        expect(ends.map((value) => [value.ownerId, value.retainUntil])).toEqual([
          ["long", day(90)],
          ["short", day(30)],
        ]);
        await expect(
          repository.countLive({ tenantId: ACME, objectId: OBJECT, now: day(10_000) }),
        ).resolves.toBe(1);
      });
    });
  },
);
