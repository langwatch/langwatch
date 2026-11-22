/**
 * The reaper's one cross-project read over real Postgres: the projects that hold a
 * pending upload past its window, in id order, paged after a given id.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaStoredObjectRecordRepository } from "../prisma.stored-object-record.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-stored-object-reap-${randomUUID()}`;
const expiredA = `${namespace}-a`;
const expiredB = `${namespace}-b`;
const freshOnly = `${namespace}-c`;
const confirmedOnly = `${namespace}-d`;
const now = Temporal.Instant.from("2026-11-17T12:00:00Z");
const hourAgo = new Date("2026-11-17T11:00:00Z");
const inAnHour = new Date("2026-11-17T13:00:00Z");

describe.skipIf(!databaseUrl)("Prisma stored-object record: projects with expired uploads", () => {
  let connection: PrismaConnection;
  let repository: PrismaStoredObjectRecordRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:stored-object:test:expired-uploads"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaStoredObjectRecordRepository.create({ prisma: connection.client });

    const row = (tenantId: string, id: string, status: string, expiresAt: Date | null) => ({
      tenantId,
      id,
      status,
      purpose: "dataset_import",
      ownerKind: "project",
      ownerId: tenantId,
      filename: "a.csv",
      sha256: "",
      sizeBytes: 3n,
      mediaType: "text/csv",
      audiences: ["datasets:view"],
      source: "canonical",
      createdAt: hourAgo,
      expiresAt,
    });
    await connection.client.storedObject.createMany({
      data: [
        row(expiredA, `${namespace}-1`, "pending", hourAgo),
        row(expiredA, `${namespace}-2`, "pending", hourAgo),
        row(expiredB, `${namespace}-3`, "pending", hourAgo),
        row(freshOnly, `${namespace}-4`, "pending", inAnHour),
        row(confirmedOnly, `${namespace}-5`, "available", null),
      ],
    });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const tenantId of [expiredA, expiredB, freshOnly, confirmedOnly]) {
      await connection.client.storedObject.deleteMany({ where: { tenantId } });
    }
    await connection.closeOnce();
  });

  /** @scenario "Expired pending uploads are reaped on a schedule" */
  it("names each project with an expired pending upload once, in id order", async () => {
    const found = await repository.findTenantsWithExpiredUploads({
      expiresBefore: now,
      afterTenantId: namespace,
      limit: 10,
    });

    expect(found.filter((id) => id.startsWith(namespace))).toEqual([expiredA, expiredB]);
  });

  /** @scenario "Expired pending uploads are reaped on a schedule" */
  it("pages after the last project it named", async () => {
    const found = await repository.findTenantsWithExpiredUploads({
      expiresBefore: now,
      afterTenantId: expiredA,
      limit: 1,
    });

    expect(found).toEqual([expiredB]);
  });
});
