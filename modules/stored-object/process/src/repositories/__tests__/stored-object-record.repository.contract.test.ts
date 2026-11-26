/**
 * @vitest-environment node
 * The row contract, stated once per backend. Rows are keyed by tenant.
 * @see modules/stored-object/specs/stored-objects.feature
 */
import type {
  StoredObjectId,
  StoredObjectLifecycleStatus,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryStoredObjectOwnerLinkRepository } from "../memory/memory.stored-object-owner-link.repository.ts";
import { MemoryStoredObjectRecordRepository } from "../memory/memory.stored-object-record.repository.ts";
import { PrismaStoredObjectOwnerLinkRepository } from "../prisma/prisma.stored-object-owner-link.repository.ts";
import { PrismaStoredObjectRecordRepository } from "../prisma/prisma.stored-object-record.repository.ts";
import type { StoredObjectOwnerLinkRepository } from "../stored-object-owner-link.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../stored-object-record.repository.ts";
import { emptyTenants, findPrismaTestClients } from "./support/prisma-test-database.support.ts";

const backends: readonly {
  name: string;
  create: () => StoredObjectRecordRepository;
  createWithLinks: () => {
    records: StoredObjectRecordRepository;
    links: StoredObjectOwnerLinkRepository;
  };
  reset: () => Promise<void>;
}[] = [
  {
    name: "memory",
    create: () => MemoryStoredObjectRecordRepository.create(),
    createWithLinks: () => {
      const links = MemoryStoredObjectOwnerLinkRepository.create();
      return { records: MemoryStoredObjectRecordRepository.create([], links), links };
    },
    reset: async () => {},
  },
  ...findPrismaTestClients().map((prisma) => ({
    name: "Postgres",
    create: () => PrismaStoredObjectRecordRepository.create({ prisma }),
    createWithLinks: () => ({
      records: PrismaStoredObjectRecordRepository.create({ prisma }),
      links: PrismaStoredObjectOwnerLinkRepository.create({ prisma }),
    }),
    reset: () => emptyTenants({ prisma, tenantIds: [ACME, OTHER] }),
  })),
];

const ACME = "project_acme" as StoredObjectProjectId;
const OTHER = "project_other" as StoredObjectProjectId;
const AT = Temporal.Instant.from("2026-08-22T00:00:00.000Z");

function record(overrides: Partial<StoredObjectRecord> = {}): StoredObjectRecord {
  return {
    tenantId: ACME,
    id: "so_aaaaaaaa" as StoredObjectId,
    status: "available",
    purpose: "trace_content",
    ownerKind: "trace",
    ownerId: "trace-1",
    filename: "input.bin",
    sha256: "a".repeat(64),
    byteLength: 3,
    mediaType: "application/octet-stream",
    mediaTypeVerified: true,
    storage: { provider: "s3", destinationId: "primary", relativeId: "acme/so_aaaaaaaa" },
    generation: 0,
    audiences: ["project:view"],
    expiresAt: null,
    availableAt: AT,
    deletedAt: null,
    source: "canonical",
    legacyFingerprint: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

describe.each(backends)(
  "given the $name stored-object record repository",
  ({ create, createWithLinks, reset }) => {
    beforeEach(reset);

    describe("when the tenant has written no row", () => {
      /** @scenario "The memory and Postgres stored-object repositories answer alike" */
      it("answers nothing for an id it never held", async () => {
        const repository = create();

        await expect(
          repository.findById({ tenantId: ACME, id: "so_absent" as StoredObjectId }),
        ).resolves.toBeNull();
      });

      it("counts no active bytes", async () => {
        const repository = create();

        await expect(repository.countActive({ tenantId: ACME })).resolves.toEqual({
          activeObjectCount: 0,
          activeByteLength: 0,
        });
      });

      it("pages nothing", async () => {
        const repository = create();

        await expect(repository.findPage({ tenantId: ACME, limit: 10 })).resolves.toEqual([]);
      });
    });

    describe("when a row is written", () => {
      /** @scenario "The memory and Postgres stored-object repositories answer alike" */
      it("reads the row back on its own compound key", async () => {
        const repository = create();
        const written = record();

        await repository.upsert(written);

        await expect(repository.findById({ tenantId: ACME, id: written.id })).resolves.toEqual(
          written,
        );
      });

      /** @scenario "The memory and Postgres stored-object repositories answer alike" */
      it("rewrites the same row rather than adding a second one", async () => {
        const repository = create();

        await repository.upsert(record());
        await repository.upsert(record({ generation: 1, status: "deleted", deletedAt: AT }));

        await expect(repository.findPage({ tenantId: ACME, limit: 10 })).resolves.toMatchObject([
          { generation: 1, status: "deleted" },
        ]);
      });

      it("counts and sums only the rows that are available", async () => {
        const repository = create();

        await repository.upsert(record({ id: "so_a" as StoredObjectId, byteLength: 3 }));
        await repository.upsert(record({ id: "so_b" as StoredObjectId, byteLength: 5 }));
        await repository.upsert(
          record({ id: "so_c" as StoredObjectId, byteLength: 9, status: "deleted" }),
        );

        await expect(repository.countActive({ tenantId: ACME })).resolves.toEqual({
          activeObjectCount: 2,
          activeByteLength: 8,
        });
      });

      it("counts only the purpose it was asked about", async () => {
        const repository = create();

        await repository.upsert(record({ id: "so_a" as StoredObjectId, byteLength: 3 }));
        await repository.upsert(
          record({ id: "so_b" as StoredObjectId, byteLength: 5, purpose: "scenario_content" }),
        );

        await expect(
          repository.countActive({ tenantId: ACME, purpose: "scenario_content" }),
        ).resolves.toEqual({ activeObjectCount: 1, activeByteLength: 5 });
      });
    });

    describe("when a page is asked for", () => {
      /** @scenario "The memory and Postgres stored-object repositories answer alike" */
      it("orders by id and resumes after the id it was given", async () => {
        const repository = create();

        for (const id of ["so_c", "so_a", "so_b"]) {
          await repository.upsert(record({ id: id as StoredObjectId }));
        }

        await expect(repository.findPage({ tenantId: ACME, limit: 2 })).resolves.toMatchObject([
          { id: "so_a" },
          { id: "so_b" },
        ]);

        await expect(
          repository.findPage({ tenantId: ACME, afterId: "so_b" as StoredObjectId, limit: 10 }),
        ).resolves.toMatchObject([{ id: "so_c" }]);
      });

      it("narrows to one lifecycle status", async () => {
        const repository = create();
        const status: StoredObjectLifecycleStatus = "pending";

        await repository.upsert(record({ id: "so_a" as StoredObjectId }));
        await repository.upsert(record({ id: "so_b" as StoredObjectId, status }));

        await expect(
          repository.findPage({ tenantId: ACME, status, limit: 10 }),
        ).resolves.toMatchObject([{ id: "so_b" }]);
      });

      it("narrows to the rows that expired before a moment", async () => {
        const repository = create();
        const expired = Temporal.Instant.from("2026-08-21T00:00:00.000Z");

        await repository.upsert(record({ id: "so_a" as StoredObjectId, expiresAt: expired }));
        await repository.upsert(record({ id: "so_b" as StoredObjectId, expiresAt: null }));

        await expect(
          repository.findPage({ tenantId: ACME, expiresBefore: AT, limit: 10 }),
        ).resolves.toMatchObject([{ id: "so_a" }]);
      });
    });

    describe("when a row is moved on conditionally", () => {
      /** @scenario "A confirm and the reaper never both win" */
      it("writes the next row while the status and generation still hold", async () => {
        const repository = create();
        const pending = record({ status: "pending", generation: 0 });
        await repository.upsert(pending);

        await expect(
          repository.transition({
            expected: pending,
            next: { ...pending, status: "available", generation: 1 },
          }),
        ).resolves.toBe(true);
        await expect(
          repository.findById({ tenantId: ACME, id: pending.id }),
        ).resolves.toMatchObject({
          status: "available",
          generation: 1,
        });
      });

      /** @scenario "A confirm and the reaper never both win" */
      it("loses the race to a write that moved the row first, and changes nothing", async () => {
        const repository = create();
        const pending = record({ status: "pending", generation: 0 });
        await repository.upsert(pending);
        await repository.transition({
          expected: pending,
          next: { ...pending, status: "failed", generation: 1 },
        });

        await expect(
          repository.transition({
            expected: pending,
            next: { ...pending, status: "available", generation: 1 },
          }),
        ).resolves.toBe(false);
        await expect(
          repository.transition({
            expected: { status: "failed", generation: 0 },
            next: { ...pending, status: "available", generation: 2 },
          }),
        ).resolves.toBe(false);
        await expect(
          repository.findById({ tenantId: ACME, id: pending.id }),
        ).resolves.toMatchObject({
          status: "failed",
          generation: 1,
        });
      });

      it("never moves another tenant's row under the same id", async () => {
        const repository = create();
        const theirs = record({ tenantId: OTHER, status: "pending", generation: 0 });
        await repository.upsert(theirs);

        await expect(
          repository.transition({
            expected: theirs,
            next: { ...theirs, tenantId: ACME, status: "available", generation: 1 },
          }),
        ).resolves.toBe(false);
        await expect(
          repository.findById({ tenantId: OTHER, id: theirs.id }),
        ).resolves.toMatchObject({
          status: "pending",
        });
      });

      it("pages rows of any of several statuses", async () => {
        const repository = create();
        await repository.upsert(record({ id: "so_a" as StoredObjectId, status: "pending" }));
        await repository.upsert(record({ id: "so_b" as StoredObjectId, status: "uploading" }));
        await repository.upsert(record({ id: "so_c" as StoredObjectId, status: "failed" }));

        await expect(
          repository.findPage({ tenantId: ACME, status: ["pending", "uploading"], limit: 10 }),
        ).resolves.toMatchObject([{ id: "so_a" }, { id: "so_b" }]);
      });
    });

    describe("when projects holding expired pending uploads are asked for", () => {
      /** @scenario "Expired pending uploads are reaped on a schedule" */
      it("names each project with an open upload or held bytes once, in order, across tenants", async () => {
        const repository = create();
        const expired = Temporal.Instant.from("2026-08-21T00:00:00.000Z");
        const later = Temporal.Instant.from("2026-08-23T00:00:00.000Z");
        const pending: { status: StoredObjectLifecycleStatus } = { status: "pending" };

        await repository.upsert(record({ ...pending, tenantId: OTHER, expiresAt: expired }));
        await repository.upsert(
          record({ ...pending, id: "so_a" as StoredObjectId, expiresAt: expired }),
        );
        await repository.upsert(
          record({ ...pending, id: "so_b" as StoredObjectId, expiresAt: expired }),
        );
        await repository.upsert(
          record({ ...pending, id: "so_c" as StoredObjectId, expiresAt: later }),
        );
        await repository.upsert(
          record({ id: "so_d" as StoredObjectId, status: "failed", expiresAt: expired }),
        );
        await repository.upsert(
          record({
            tenantId: "project_uploading" as StoredObjectProjectId,
            status: "uploading",
            expiresAt: expired,
          }),
        );
        await repository.upsert(
          record({
            tenantId: "project_reaped" as StoredObjectProjectId,
            status: "failed",
            storage: null,
            expiresAt: expired,
          }),
        );
        await repository.upsert(
          record({
            tenantId: "project_deleted_bytes" as StoredObjectProjectId,
            status: "deleted",
            expiresAt: expired,
          }),
        );

        await expect(
          repository.findTenantsWithExpiredUploads({ expiresBefore: AT, limit: 10 }),
        ).resolves.toEqual([ACME, "project_deleted_bytes", OTHER, "project_uploading"]);
        await expect(
          repository.findTenantsWithExpiredUploads({
            expiresBefore: AT,
            afterTenantId: ACME,
            limit: 10,
          }),
        ).resolves.toEqual(["project_deleted_bytes", OTHER, "project_uploading"]);
        await expect(
          repository.findTenantsWithExpiredUploads({ expiresBefore: AT, limit: 1 }),
        ).resolves.toEqual([ACME]);
      });
    });

    describe("when another tenant holds a row with the same id", () => {
      /** @scenario "The memory and Postgres stored-object repositories answer alike" */
      it("never answers the other tenant's row", async () => {
        const repository = create();

        await repository.upsert(record({ tenantId: OTHER }));

        await expect(
          repository.findById({ tenantId: ACME, id: "so_aaaaaaaa" as StoredObjectId }),
        ).resolves.toBeNull();
        await expect(repository.countActive({ tenantId: ACME })).resolves.toEqual({
          activeObjectCount: 0,
          activeByteLength: 0,
        });
        await expect(repository.findPage({ tenantId: ACME, limit: 10 })).resolves.toEqual([]);
      });

      it("keeps both tenants' rows apart under one id", async () => {
        const repository = create();

        await repository.upsert(record({ tenantId: ACME, byteLength: 3 }));
        await repository.upsert(record({ tenantId: OTHER, byteLength: 7 }));

        await expect(repository.countActive({ tenantId: OTHER })).resolves.toEqual({
          activeObjectCount: 1,
          activeByteLength: 7,
        });
      });
    });

    describe("when rows hold the same bytes", () => {
      it("finds only available rows of the same purpose, digest and media type, oldest first", async () => {
        const repository = create();
        const later = record({ id: "so_bbbbbbbb" as StoredObjectId });
        await repository.upsert(later);
        await repository.upsert(record());
        await repository.upsert(record({ id: "so_deleted" as StoredObjectId, status: "deleted" }));
        await repository.upsert(
          record({ id: "so_scenario" as StoredObjectId, purpose: "scenario_event" }),
        );
        await repository.upsert(
          record({ id: "so_octet" as StoredObjectId, mediaType: "image/png" }),
        );
        await repository.upsert(record({ id: "so_other" as StoredObjectId, tenantId: OTHER }));

        const found = await repository.findReusable({
          tenantId: ACME,
          purpose: "trace_content",
          sha256: "a".repeat(64),
          mediaType: "application/octet-stream",
          limit: 8,
        });
        const first = await repository.findReusable({
          tenantId: ACME,
          purpose: "trace_content",
          sha256: "a".repeat(64),
          mediaType: "application/octet-stream",
          limit: 1,
        });

        expect(found.map((value) => value.id)).toEqual(["so_aaaaaaaa", "so_bbbbbbbb"]);
        expect(first.map((value) => value.id)).toEqual(["so_aaaaaaaa"]);
      });
    });

    describe("when the sweep deletes an object only if no live link holds it", () => {
      /** @scenario "An object another owner still holds survives the sweep" */
      it("keeps a held object and deletes it once every link has ended", async () => {
        const { records, links } = createWithLinks();
        const id = "so_aaaaaaaa" as StoredObjectId;
        const link = {
          tenantId: ACME,
          objectId: id,
          ownerKind: "trace",
          createdAt: AT,
          updatedAt: AT,
        };
        await records.upsert(record());
        await links.raise({ ...link, ownerId: "t1", retainUntil: AT.add({ hours: 24 }) });
        await links.raise({ ...link, ownerId: "t2", retainUntil: AT.add({ hours: 48 }) });

        const at = (hours: number) => AT.add({ hours });
        await expect(
          records.markDeletedIfUnheld({ tenantId: ACME, id, now: at(30) }),
        ).resolves.toBe(false);
        await expect(records.findById({ tenantId: ACME, id })).resolves.toMatchObject({
          status: "available",
        });
        await expect(
          records.markDeletedIfUnheld({ tenantId: ACME, id, now: at(48) }),
        ).resolves.toBe(true);
        await expect(records.findById({ tenantId: ACME, id })).resolves.toMatchObject({
          status: "deleted",
          expiresAt: at(48),
        });
        await expect(
          records.markDeletedIfUnheld({ tenantId: ACME, id, now: at(48) }),
        ).resolves.toBe(false);
      });
    });

    describe("when a reuse adds its audience", () => {
      /** @scenario "A reuse adds the caller's audience" */
      it("appends it once, and never to a row that is no longer available", async () => {
        const { records } = createWithLinks();
        const id = "so_aaaaaaaa" as StoredObjectId;
        const gone = "so_deleted" as StoredObjectId;
        await records.upsert(record());
        await records.upsert(record({ id: gone, status: "deleted" }));

        await records.addAudience({ tenantId: ACME, id, audience: "traces:view", at: AT });
        await records.addAudience({ tenantId: ACME, id, audience: "traces:view", at: AT });
        await records.addAudience({ tenantId: ACME, id: gone, audience: "traces:view", at: AT });

        await expect(records.findById({ tenantId: ACME, id })).resolves.toMatchObject({
          audiences: ["project:view", "traces:view"],
        });
        await expect(records.findById({ tenantId: ACME, id: gone })).resolves.toMatchObject({
          audiences: ["project:view"],
        });
      });
    });
  },
);
