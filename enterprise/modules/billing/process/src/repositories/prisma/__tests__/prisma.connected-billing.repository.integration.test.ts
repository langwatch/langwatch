// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */
import { randomUUID } from "node:crypto";

import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import type { ConnectedSeatChangeRecord } from "../../connected-billing.repository.ts";
import { PrismaConnectedBillingRepository } from "../prisma.connected-billing.repository.ts";

const RUN = `seat-${randomUUID().slice(0, 8)}`;
const DATABASE_URL = process.env.DATABASE_URL;

const notOnboarded = (licenseRowId: string): ConnectedSeatChangeRecord => ({
  licenseRowId,
  accountId: null,
  organizationId: `org-${RUN}`,
  changedAt: Temporal.Instant.from("2026-07-04T10:00:00Z"),
  addedSeats: 8,
  unitAmountCents: 0,
  amountCents: 0,
  currency: null,
  state: "not_onboarded",
  stripeInvoiceId: null,
});

describe.skipIf(!DATABASE_URL)("the seat change decisions on Postgres", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DATABASE_URL ?? "").adapter,
  });
  const repository = PrismaConnectedBillingRepository.create(prisma);

  afterAll(async () => {
    await prisma.connectedSeatChange.deleteMany({ where: { licenseId: { startsWith: RUN } } });
    await prisma.$disconnect();
  });

  it("stores the first decision once, and the table refuses a second", async () => {
    const licenseRowId = `${RUN}-once`;

    await expect(repository.createSeatChange(notOnboarded(licenseRowId))).resolves.toBe(true);
    await expect(
      repository.createSeatChange({ ...notOnboarded(licenseRowId), state: "intent" }),
    ).resolves.toBe(false);
    await expect(repository.findSeatChangesByLicenseRows([licenseRowId])).resolves.toMatchObject([
      { state: "not_onboarded", accountId: null, currency: null },
    ]);
  });

  it("lists an organization's changes, and a change the previous image billed to its account", async () => {
    await repository.createSeatChange(notOnboarded(`${RUN}-org`));
    await repository.createSeatChange({
      ...notOnboarded(`${RUN}-account`),
      organizationId: null,
      accountId: `acct-${RUN}`,
      currency: "USD",
      state: "nothing_to_invoice",
    });

    const listed = await repository.findSeatChangesForOrganization({
      organizationId: `org-${RUN}`,
      accountId: `acct-${RUN}`,
    });

    expect(listed.map((change) => change.licenseRowId).toSorted()).toEqual(
      [`${RUN}-account`, `${RUN}-once`, `${RUN}-org`].toSorted(),
    );
  });
});
