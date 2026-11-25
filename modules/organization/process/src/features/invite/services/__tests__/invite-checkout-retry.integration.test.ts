/**
 * @vitest-environment node
 * @see specs/licensing/billing-only-invite.feature
 * A new checkout cancels the abandoned checkouts and their PAYMENT_PENDING invites only; an
 * invite made outside any checkout stays pending.
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

import { PrismaOrganizationInviteRepository } from "../../../../repositories/prisma/prisma.organization-invite.repository.ts";
import { InviteService } from "../invite.service.ts";
import { makeInviteDeps } from "./support/invite-fakes.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("a retried checkout and the invites around it (Postgres)", () => {
  const ns = `inv-retry-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:invite-checkout-retry"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const service = InviteService.create(
    makeInviteDeps({ invites: PrismaOrganizationInviteRepository.create({ database: prisma }) }),
  );
  const abandonedSubscriptionId = `sub-abandoned-${ns}`;
  let organizationId: string;

  function invite({
    email,
    status,
    subscriptionId,
    billingOnly = false,
  }: {
    email: string;
    status: "PENDING" | "PAYMENT_PENDING";
    subscriptionId?: string;
    billingOnly?: boolean;
  }) {
    return prisma.organizationInvite.create({
      data: {
        email,
        inviteCode: `code-${nanoid(10)}`,
        organizationId,
        teamIds: "",
        role: "EXTERNAL",
        status,
        billingOnly,
        subscriptionId: subscriptionId ?? null,
        expiration: status === "PENDING" ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
      },
    });
  }

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await prisma.organizationInvite.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("given pending invites that no checkout created", () => {
    describe("when a new checkout cancels the abandoned one", () => {
      /** @scenario "A new checkout keeps invites made outside a checkout" */
      it("keeps them pending and drops only the abandoned checkout's invite", async () => {
        const outside = await invite({ email: `outside-${ns}@acme.test`, status: "PENDING" });
        const payer = await invite({
          email: `payer-${ns}@acme.test`,
          status: "PENDING",
          billingOnly: true,
        });
        const held = await invite({
          email: `held-${ns}@acme.test`,
          status: "PAYMENT_PENDING",
          subscriptionId: abandonedSubscriptionId,
        });

        await service.cancelPaymentPendingInvites({
          organizationId,
          subscriptionIds: [abandonedSubscriptionId],
        });

        const left = await prisma.organizationInvite.findMany({
          where: { organizationId, id: { in: [outside.id, payer.id, held.id] } },
          select: { id: true, status: true },
        });
        expect(left.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
          [
            { id: outside.id, status: "PENDING" },
            { id: payer.id, status: "PENDING" },
          ].toSorted((a, b) => a.id.localeCompare(b.id)),
        );
      });
    });
  });
});
