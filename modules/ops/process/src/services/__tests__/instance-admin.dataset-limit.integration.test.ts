/**
 * @vitest-environment node
 * The back office's max dataset file size, written through the service to a real Postgres.
 */
import { randomUUID } from "node:crypto";

import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { createLogger } from "@langwatch/observability";
import type { AdminOperationInput } from "@langwatch/ops-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaInstanceAdminRepository } from "../../repositories/prisma/prisma.instance-admin.repository.ts";
import { AdminAuditSink } from "../impersonation.service.ts";
import { InstanceAdminService } from "../instance-admin.service.ts";
import { TestUserApi } from "./support/test-user-api.ts";

class SilentAudit extends AdminAuditSink {
  async record(): Promise<void> {}
}

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("the back office's max dataset file size on Postgres", () => {
  const organizationId = `dataset-limit-${randomUUID().slice(0, 8)}`;
  let prisma: PrismaClient;
  let service: InstanceAdminService;

  const operation = (
    method: AdminOperationInput["method"],
    data?: Record<string, unknown>,
  ): AdminOperationInput => ({
    resource: "organization",
    method,
    params: { id: organizationId, ...(data ? { data } : {}) },
    actorId: "olive",
    req: { headers: {} },
  });

  const storedLimit = async () =>
    (
      await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { datasetAttachmentMaxMb: true },
      })
    )?.datasetAttachmentMaxMb;

  beforeAll(async () => {
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:ops:test:dataset-limit"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    service = InstanceAdminService.create({
      repository: PrismaInstanceAdminRepository.create(prisma),
      users: new TestUserApi(),
      audit: new SilentAudit(),
    });
    await prisma.organization.create({
      data: { id: organizationId, name: organizationId, slug: organizationId },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("given an organization stored with no max dataset file size", () => {
    describe("when an operator sets it to 100 MB through the Back office", () => {
      /** @scenario "The max dataset file size an operator sets reaches the organization's stored row" */
      it("stores 100 MB, reads it back, and leaves the row alone on a refused value", async () => {
        expect(await storedLimit()).toBeNull();

        await service.execute(operation("update", { datasetAttachmentMaxMb: 100 }));

        expect(await storedLimit()).toBe(100);
        const read = await service.execute(operation("getOne"));
        expect(read.data).toMatchObject({ id: organizationId, datasetAttachmentMaxMb: 100 });

        const refusal = await service
          .execute(operation("update", { datasetAttachmentMaxMb: 5000 }))
          .then(
            () => null,
            (error: unknown) => readHandledError(error),
          );

        expect(refusal?.code).toBe("validation_error");
        expect(await storedLimit()).toBe(100);

        await service.execute(operation("update", { datasetAttachmentMaxMb: null }));

        expect(await storedLimit()).toBeNull();
      });
    });
  });
});
