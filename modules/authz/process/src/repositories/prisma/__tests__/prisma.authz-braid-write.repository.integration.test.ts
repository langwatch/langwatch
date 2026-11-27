/**
 * ADR-201 §1: the braid writes table over a real database: a write reads back whole by its command
 * id and among the reader's recent writes, and a second write under one command id is refused.
 * @see modules/authz/specs/braids.feature
 */
import { randomUUID } from "node:crypto";

import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import type { AuthzBraidWrite } from "../../authz-braid-write.repository.ts";
import { PrismaAuthzBraidWriteRepository } from "../prisma.authz-braid-write.repository.ts";

const DB_URL = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("given the braid writes over a real database", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const writes = PrismaAuthzBraidWriteRepository.create({ database: prisma });
  const organizationId = `org_braid_write_${randomUUID()}`;
  const createdAt = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2026, 10, 18, 12));
  const write: AuthzBraidWrite = {
    organizationId,
    commandId: "cmd_0123456789abcdef",
    grantId: "grant_one",
    readerProjectId: "proj_orchestrator",
    ownerProjectId: "proj_specialists",
    termsKey: '["proj_specialists","none",0,null,null]',
    condition: { type: "span", from: "2026-10-01T00:00:00Z" },
    expiresAt: Temporal.Instant.fromEpochMilliseconds(Date.UTC(2027, 0, 1)),
    replacesGrantId: null,
    createdByUserId: "user_ana",
    createdAt,
  };

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "AuthzBraidWrite" WHERE "organizationId" = ${organizationId}`;
    await prisma.$disconnect();
  });

  it("reads a write back by its command id and among the reader's writes", async () => {
    await writes.create({ write });

    expect(await writes.findByCommand({ organizationId, commandId: write.commandId })).toEqual([
      write,
    ]);
    expect(
      await writes.findIntoReader({ organizationId, readerProjectId: write.readerProjectId }),
    ).toEqual([write]);
    expect(await writes.findIntoReader({ organizationId, readerProjectId: "proj_nobody" })).toEqual(
      [],
    );
  });

  it("refuses a second write under the same command id", async () => {
    await expect(writes.create({ write: { ...write, grantId: "grant_two" } })).rejects.toThrow(
      /AuthzBraidWrite_pkey|duplicate key|Unique constraint/,
    );
  });
});
