/**
 * The per-file dataset limit an operator stored on the organization, read against Postgres.
 * @vitest-environment node
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaOrganizationRepository dataset limits read", () => {
  const namespace = `dataset-limits-${nanoid(8)}`;
  const raisedId = `${namespace}-raised`;
  const defaultId = `${namespace}-default`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:dataset-limits"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: raisedId, name: raisedId, slug: raisedId, datasetAttachmentMaxMb: 100 },
    });
    await prisma.organization.create({
      data: { id: defaultId, name: defaultId, slug: defaultId },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [raisedId, defaultId] } } });
    await prisma.$disconnect();
  });

  describe("given an organization whose largest dataset file is stored as 100 MB", () => {
    describe("when the organization's dataset limits are read", () => {
      /** @scenario "The per-file dataset limit an operator stored is read back in bytes" */
      it("answers the limit in bytes, and none where nothing is stored", async () => {
        expect(await repository.getDatasetLimits({ organizationId: raisedId })).toEqual({
          attachmentMaxBytes: 104_857_600,
        });
        expect(await repository.getDatasetLimits({ organizationId: defaultId })).toEqual({
          attachmentMaxBytes: null,
        });
        expect(await repository.getDatasetLimits({ organizationId: `${namespace}-none` })).toEqual({
          attachmentMaxBytes: null,
        });
      });
    });
  });
});
