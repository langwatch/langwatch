/**
 * @vitest-environment node
 * Cloud admin's one-live-plan refusal, written through the service to a real Postgres that
 * holds billing's index.
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
import { billingLivePlanRule, planSlotOf } from "./support/billing-live-plan-rule.ts";
import { TestUserApi } from "./support/test-user-api.ts";

class SilentAudit extends AdminAuditSink {
  async record(): Promise<void> {}
}

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("Cloud admin's subscription writes on Postgres", () => {
  const run = `ops-sub-${randomUUID().slice(0, 8)}`;
  let prisma: PrismaClient;
  const organizationIds: string[] = [];
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

  const cloudAdmin = ({ landsAfterCheck }: { landsAfterCheck?: () => Promise<void> } = {}) =>
    InstanceAdminService.create({
      operators: noOperators,
      repository: PrismaInstanceAdminRepository.create(prisma),
      users: new TestUserApi(),
      accounts: {
        deactivateUser: () => Promise.reject(new Error("unreached")),
        changeUserEmail: () => Promise.reject(new Error("unreached")),
      },
      billing: billingLivePlanRule({
        rows: async () =>
          (
            await prisma.subscription.findMany({
              where: { organizationId: { in: organizationIds } },
            })
          ).map(planSlotOf),
        ...(landsAfterCheck ? { landsAfterCheck } : {}),
      }),
      audit: new SilentAudit(),
    });

  const organization = async (suffix: string) => {
    const { id } = await prisma.organization.create({
      data: { name: "ACME", slug: `--${run}-${suffix}` },
    });
    organizationIds.push(id);
    return id;
  };

  beforeAll(async () => {
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:ops:test:subscriptions"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    organizationId = await organization("acme");
    await prisma.subscription.createMany({
      data: [
        {
          id: `${run}_live`,
          organizationId,
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          status: "ACTIVE",
          stripeSubscriptionId: `${run}_live_stripe`,
        },
        {
          id: `${run}_tiered`,
          organizationId,
          plan: "LAUNCH",
          status: "ACTIVE",
          stripeSubscriptionId: `${run}_tiered_stripe`,
        },
        {
          id: `${run}_pending`,
          organizationId,
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          status: "PENDING",
          stripeSubscriptionId: `${run}_pending_stripe`,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  /** @scenario "Cloud admin refuses a second live Stripe-backed plan for an organization" */
  it("refuses activating a linked PENDING row beside the live one and leaves it PENDING", async () => {
    await expect(
      cloudAdmin().execute(write("update", { id: `${run}_pending`, data: { status: "ACTIVE" } })),
    ).rejects.toMatchObject({
      code: "ops_subscription_already_active",
      meta: { organizationId, activeSubscriptionIds: [`${run}_live`] },
    });
    const pending = await prisma.subscription.findUniqueOrThrow({
      where: { id: `${run}_pending` },
    });
    expect(pending.status).toBe("PENDING");
  });

  /** @scenario "Cloud admin still edits an organization's live plan" */
  it("saves an edit to the live one that keeps it active", async () => {
    await cloudAdmin().execute(
      write("update", { id: `${run}_live`, data: { status: "ACTIVE", maxMembers: 9 } }),
    );
    const live = await prisma.subscription.findUniqueOrThrow({ where: { id: `${run}_live` } });
    expect(live.maxMembers).toBe(9);
  });

  /** @scenario "Cloud admin edits the tiered plan while the seat plan replacing it is live" */
  it("saves an edit to the active tiered plan beside the live seat plan", async () => {
    await cloudAdmin().execute(
      write("update", { id: `${run}_tiered`, data: { status: "ACTIVE", maxMembers: 4 } }),
    );
    const tiered = await prisma.subscription.findUniqueOrThrow({
      where: { id: `${run}_tiered` },
    });
    expect(tiered).toMatchObject({ status: "ACTIVE", maxMembers: 4 });
  });

  /** @scenario "The database refuses a second linked live plan the Cloud admin check missed" */
  it("refuses a second linked active row whose rival landed after the check", async () => {
    const otherOrganizationId = await organization("raced");
    const linked = (id: string) => ({
      id,
      organizationId: otherOrganizationId,
      status: "ACTIVE" as const,
      plan: "GROWTH_SEAT_EUR_MONTHLY" as const,
      stripeSubscriptionId: `${id}_stripe`,
    });
    const service = cloudAdmin({
      landsAfterCheck: async () => {
        await prisma.subscription.create({ data: linked(`${run}_linked_a`) });
      },
    });

    await expect(
      service.execute(write("create", { data: linked(`${run}_linked_b`) })),
    ).rejects.toMatchObject({
      code: "ops_subscription_already_active",
      meta: {
        organizationId: otherOrganizationId,
        activeSubscriptionIds: [`${run}_linked_a`],
      },
    });
    expect(
      await prisma.subscription.findMany({
        where: { organizationId: otherOrganizationId },
        select: { id: true },
      }),
    ).toEqual([{ id: `${run}_linked_a` }]);
  });
});
