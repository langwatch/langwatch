/**
 * @vitest-environment node
 * The Over 2x seats filter on the Cloud admin seat use page asks the admin organization
 * resource for a list of ids.
 * @see modules/ops/specs/seat-sharing-check.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaInstanceAdminRepository } from "../prisma.instance-admin.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaInstanceAdminRepository organization id filter", () => {
  const run = randomUUID().slice(0, 8);
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:ops:test:admin-id-filter"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const ids = [`org_acme_${run}`, `org_globex_${run}`, `org_initech_${run}`];

  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: ids[0]!, name: `ACME ${run}`, slug: `--test-acme-${run}` },
        { id: ids[1]!, name: `Globex ${run}`, slug: `--test-globex-${run}` },
        { id: ids[2]!, name: `Initech ${run}`, slug: `--test-initech-${run}` },
      ],
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  function list(filter: Record<string, unknown>) {
    return PrismaInstanceAdminRepository.create(prisma).execute({
      method: "getList",
      resource: "organization",
      params: { filter, pagination: { page: 1, perPage: 25 } },
      actorId: "operator_1",
      req: { headers: {} },
    });
  }

  /** @scenario "The organization list narrows to the flagged organizations' ids" */
  it("lists only the asked ids, and a search narrows within them", async () => {
    const narrowed = await list({ id: [ids[0], ids[2]] });
    if (!("total" in narrowed)) throw new Error("a list answers rows and a total");
    expect(narrowed.total).toBe(2);
    expect((narrowed.data as { id: string }[]).map((row) => row.id)).toEqual(
      expect.arrayContaining([ids[0], ids[2]]),
    );

    const searched = await list({ id: [ids[0], ids[2]], query: "Initech" });
    if (!("total" in searched)) throw new Error("a list answers rows and a total");
    expect((searched.data as { id: string }[]).map((row) => row.id)).toEqual([ids[2]]);
  });
});
