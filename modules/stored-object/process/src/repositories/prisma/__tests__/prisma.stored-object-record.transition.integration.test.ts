/**
 * The upload lifecycle's conditional write over real Postgres: a row moves on only
 * while its status and generation still hold, so of two racing writers one loses.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { StoredObjectRecord } from "../../stored-object-record.repository.ts";
import { PrismaStoredObjectRecordRepository } from "../prisma.stored-object-record.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-stored-object-transition-${randomUUID()}`;
const tenantId = `${namespace}-a` as StoredObjectProjectId;
const otherTenantId = `${namespace}-b` as StoredObjectProjectId;
const hourAgo = Temporal.Instant.from("2026-11-17T11:00:00Z");
const now = Temporal.Instant.from("2026-11-17T12:00:00Z");

function record(overrides: Partial<StoredObjectRecord>): StoredObjectRecord {
  return {
    tenantId,
    id: `${namespace}-1` as StoredObjectId,
    status: "pending",
    purpose: "dataset_attachment",
    ownerKind: "project",
    ownerId: tenantId,
    filename: "a.csv",
    sha256: "",
    byteLength: 3,
    mediaType: "text/csv",
    mediaTypeVerified: false,
    storage: { provider: "s3", destinationId: "bucket", relativeId: `${tenantId}/object` },
    generation: 0,
    audiences: ["datasets:view"],
    expiresAt: hourAgo,
    availableAt: null,
    deletedAt: null,
    source: "canonical",
    legacyFingerprint: null,
    createdAt: hourAgo,
    updatedAt: hourAgo,
    ...overrides,
  };
}

describe.skipIf(!databaseUrl)("Prisma stored-object record: conditional transitions", () => {
  let connection: PrismaConnection;
  let repository: PrismaStoredObjectRecordRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:stored-object:test:transition"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaStoredObjectRecordRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const tenant of [tenantId, otherTenantId]) {
      await connection.client.storedObject.deleteMany({ where: { tenantId: tenant } });
    }
    await connection.closeOnce();
  });

  /** @scenario "A confirm and the reaper never both win" */
  it("applies the first of two racing writes from one read and refuses the second", async () => {
    const pending = record({ id: `${namespace}-race` as StoredObjectId });
    await repository.upsert(pending);

    const [reaped, confirmed] = await Promise.all([
      repository.transition({
        expected: pending,
        next: { ...pending, status: "failed", generation: 1, updatedAt: now },
      }),
      repository.transition({
        expected: pending,
        next: { ...pending, status: "available", generation: 1, updatedAt: now },
      }),
    ]);

    expect([reaped, confirmed].filter(Boolean)).toHaveLength(1);
    const stored = await repository.findById({ tenantId, id: pending.id });
    expect(stored?.status).toBe(reaped ? "failed" : "available");
    expect(stored?.generation).toBe(1);
  });

  /** @scenario "A confirm and the reaper never both win" */
  it("refuses a write whose expected generation is stale even when the status matches", async () => {
    const pending = record({ id: `${namespace}-stale` as StoredObjectId });
    await repository.upsert(pending);
    await repository.transition({
      expected: pending,
      next: { ...pending, status: "uploading", generation: 1 },
    });
    await repository.transition({
      expected: { status: "uploading", generation: 1 },
      next: { ...pending, sha256: "b".repeat(64), generation: 2 },
    });

    await expect(
      repository.transition({
        expected: pending,
        next: { ...pending, status: "failed", generation: 1 },
      }),
    ).resolves.toBe(false);
    await expect(repository.findById({ tenantId, id: pending.id })).resolves.toMatchObject({
      status: "pending",
      generation: 2,
      sha256: "b".repeat(64),
    });
  });

  /** @scenario "A Stored Objects import never writes over a row another run created" */
  it("inserts a row once and leaves a row that already holds the id as it is", async () => {
    const first = record({ id: `${namespace}-insert` as StoredObjectId, status: "deleted" });

    await expect(repository.insert(first)).resolves.toBe(true);
    await expect(
      repository.insert({ ...first, status: "available", generation: 0, byteLength: 4 }),
    ).resolves.toBe(false);
    await expect(repository.findById({ tenantId, id: first.id })).resolves.toMatchObject({
      status: "deleted",
      byteLength: 3,
    });
  });

  it("never moves another tenant's row under the same id", async () => {
    const theirs = record({
      tenantId: otherTenantId,
      id: `${namespace}-shared` as StoredObjectId,
      expiresAt: null,
    });
    await repository.upsert(theirs);

    await expect(
      repository.transition({
        expected: theirs,
        next: { ...theirs, tenantId, status: "available", generation: 1 },
      }),
    ).resolves.toBe(false);
    await expect(
      repository.findById({ tenantId: otherTenantId, id: theirs.id }),
    ).resolves.toMatchObject({ status: "pending", generation: 0 });
  });

  /** @scenario "Expired pending uploads are reaped on a schedule" */
  it("finds closed rows that still hold bytes, and skips those whose bytes are gone", async () => {
    const heldTenant = `${namespace}-held` as StoredObjectProjectId;
    const goneTenant = `${namespace}-gone` as StoredObjectProjectId;
    const deletedTenant = `${namespace}-deleted` as StoredObjectProjectId;
    await repository.upsert(record({ tenantId: heldTenant, status: "failed" }));
    await repository.upsert(record({ tenantId: goneTenant, status: "failed", storage: null }));
    await repository.upsert(record({ tenantId: deletedTenant, status: "deleted" }));

    try {
      const projects = await repository.findTenantsWithExpiredUploads({
        expiresBefore: now,
        afterTenantId: `${namespace}-`,
        limit: 50,
      });
      expect(projects).toContain(heldTenant);
      expect(projects).toContain(deletedTenant);
      expect(projects).not.toContain(goneTenant);
    } finally {
      for (const tenant of [heldTenant, goneTenant, deletedTenant]) {
        await connection.client.storedObject.deleteMany({ where: { tenantId: tenant } });
      }
    }
  });

  /** @scenario "Expired pending uploads are reaped on a schedule" */
  it("finds expired uploads still streaming, by project and in a project's page", async () => {
    const uploading = record({
      tenantId: otherTenantId,
      id: `${namespace}-uploading` as StoredObjectId,
      status: "uploading",
    });
    await repository.upsert(uploading);

    const projects = await repository.findTenantsWithExpiredUploads({
      expiresBefore: now,
      afterTenantId: tenantId,
      limit: 10,
    });
    expect(projects).toContain(otherTenantId);
    await expect(
      repository.findPage({
        tenantId: otherTenantId,
        status: ["pending", "uploading"],
        expiresBefore: now,
        limit: 10,
      }),
    ).resolves.toMatchObject([{ id: uploading.id, status: "uploading" }]);
  });
});
