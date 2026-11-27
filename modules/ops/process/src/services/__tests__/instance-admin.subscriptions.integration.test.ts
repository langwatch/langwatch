/**
 * @vitest-environment node
 * The Back office's one-active-subscription refusal, written through the service to a real
 * Postgres.
 * @see ../../../../specs/admin.feature
 */
import { randomUUID } from "node:crypto";

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
import { noOperators } from "./support/admin-doubles.ts";
import { TestUserApi } from "./support/test-user-api.ts";

class SilentAudit extends AdminAuditSink {
  async record(): Promise<void> {}
}

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("the Back office's subscription writes on Postgres", () => {
  const run = `ops-sub-${randomUUID().slice(0, 8)}`;
  let prisma: PrismaClient;
  let service: InstanceAdminService;
  let organizationId = "";

  const write = (
    method: AdminOperationInput["method"],
    params: AdminOperationInput["params"],
  ): AdminOperationInput => ({
    resource: "subscription",
    method,
    params,
    actorId: "olive",
    req: { headers: {} },
  });

  beforeAll(async () => {
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:ops:test:subscriptions"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    service = InstanceAdminService.create({
      operators: noOperators,
      repository: PrismaInstanceAdminRepository.create(prisma),
      users: new TestUserApi(),
      accounts: {
        deactivateUser: () => Promise.reject(new Error("unreached")),
        changeUserEmail: () => Promise.reject(new Error("unreached")),
      },
      audit: new SilentAudit(),
    });
    ({ id: organizationId } = await prisma.organization.create({
      data: { name: "ACME", slug: `--${run}` },
    }));
    await prisma.subscription.createMany({
      data: [
        { id: `${run}_live`, organizationId, plan: "GROWTH_SEAT_EUR_MONTHLY", status: "ACTIVE" },
        {
          id: `${run}_pending`,
          organizationId,
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          status: "PENDING",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  /** @scenario "The Back office refuses a second active subscription for an organization" */
  it("refuses activating a PENDING row beside the live one and leaves it PENDING", async () => {
    await expect(
      service.execute(write("update", { id: `${run}_pending`, data: { status: "ACTIVE" } })),
    ).rejects.toMatchObject({
      code: "ops_subscription_already_active",
      meta: { organizationId, activeSubscriptionIds: [`${run}_live`] },
    });
    const pending = await prisma.subscription.findUniqueOrThrow({
      where: { id: `${run}_pending` },
    });
    expect(pending.status).toBe("PENDING");
  });

  /** @scenario "The Back office still edits an organization's one active subscription" */
  it("saves an edit to the live one that keeps it active", async () => {
    await service.execute(
      write("update", { id: `${run}_live`, data: { status: "ACTIVE", maxMembers: 9 } }),
    );
    const live = await prisma.subscription.findUniqueOrThrow({ where: { id: `${run}_live` } });
    expect(live.maxMembers).toBe(9);
  });
});
