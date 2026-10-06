/**
 * @vitest-environment node
 * Trace's ingest source billing fold over real Postgres, through the tenancy-guarded client every
 * process composes. Runs with LANGWATCH_TEST_DATABASE_URL; the memory twin runs the same cases.
 */
import { randomBytes } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, describe } from "vitest";

import { describeIngestSourceBillingContract } from "../../__tests__/trace-ingest-source-billing.repository.contract.ts";
import { PrismaTraceIngestSourceBillingRepository } from "../prisma.trace-ingest-source-billing.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("given the Postgres trace ingest source billing repository", () => {
  const prisma = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("trace-ingest-source-billing-integration"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }))
    .client as PrismaClient;
  const organizations: string[] = [];

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["traceIngestSourceBilling", { organizationId: { in: organizations } }],
    ]);
    await prisma.$disconnect();
  });

  describeIngestSourceBillingContract({
    create: () => PrismaTraceIngestSourceBillingRepository.create({ prisma }),
    organizationId: () => {
      const organizationId = `organization-${randomBytes(5).toString("hex")}`;
      organizations.push(organizationId);
      return organizationId;
    },
  });
});
