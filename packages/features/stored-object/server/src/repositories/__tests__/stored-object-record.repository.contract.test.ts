/**
 * @vitest-environment node
 * The row contract, stated once per backend. Rows are keyed by tenant.
 * @see packages/features/stored-object/specs/stored-objects.feature
 */
import type {
  StoredObjectId,
  StoredObjectLifecycleStatus,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryStoredObjectRecordRepository } from "../memory/memory.stored-object-record.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../stored-object-record.repository.ts";

const backends: ReadonlyArray<{ name: string; create: () => StoredObjectRecordRepository }> = [
  { name: "memory", create: () => MemoryStoredObjectRecordRepository.create() },
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

describe.each(backends)("given the $name stored-object record repository", ({ create }) => {
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
});
