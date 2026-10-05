/**
 * @vitest-environment node
 * The organization's Instant Evals consent through the real Prisma client: a
 * second click keeps the first member's moment and id, held by Postgres.
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { fromDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)(
  "given an organization a member has switched Instant Evals on, stored in Postgres",
  () => {
    const namespace = `instant-evals-opt-in-${nanoid(8)}`;
    const prisma = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:organization:test:instant-evals-opt-in"),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
    ).client;
    const repository = PrismaOrganizationRepository.create(prisma);
    const first = { userId: `first-${namespace}`, at: new Date("2026-09-29T12:00:00Z") };
    const second = { userId: `second-${namespace}`, at: new Date("2026-09-30T12:00:00Z") };
    let organizationId = "";

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: "ACME", slug: `--test-${namespace}` },
      });
      organizationId = organization.id;
      await repository.recordInstantEvalsOptIn({
        organizationId,
        userId: first.userId,
        at: fromDate(first.at),
      });
    });

    afterAll(async () => {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.$disconnect();
    });

    describe("when another member throws the switch later", () => {
      /** @scenario "A second click against the database keeps the first record" */
      it("keeps the first member's moment and id in the stored row", async () => {
        await repository.recordInstantEvalsOptIn({
          organizationId,
          userId: second.userId,
          at: fromDate(second.at),
        });

        const stored = await prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { instantEvalsEnabledAt: true, instantEvalsEnabledByUserId: true },
        });
        expect(stored).toEqual({
          instantEvalsEnabledAt: first.at,
          instantEvalsEnabledByUserId: first.userId,
        });
        await expect(repository.isInstantEvalsOptedIn({ organizationId })).resolves.toBe(true);
      });
    });
  },
);
