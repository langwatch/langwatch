// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The memory twin of the PII redaction meter's acceptance read answers what Postgres answers.
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillingReportOrganizationRepository } from "../memory.billing-report-organization.repository.ts";
import { MemoryBillingStore } from "../memory.billing.store.ts";

function repositoryWith(piiRedactionModelAcceptedAt: Instant | null) {
  const store = MemoryBillingStore.create();
  store.organizations.set("org_1", {
    id: "org_1",
    name: "Acme",
    stripeCustomerId: "cus_1",
    pricingModel: "SEAT_EVENT",
    currency: "USD",
    selfHostedCustomer: false,
    teamIds: [],
    signupData: {},
    piiRedactionModelAcceptedAt,
  });

  return MemoryBillingReportOrganizationRepository.create(store);
}

describe("MemoryBillingReportOrganizationRepository, the PII redaction model's acceptance", () => {
  /** @scenario "An organization that accepted the price is billed only from the moment it accepted" */
  it("answers the moment an admin accepted the price, in epoch milliseconds", async () => {
    const repository = repositoryWith(Temporal.Instant.from("2026-02-10T09:30:00Z"));

    await expect(
      repository.findPiiRedactionModelAcceptedAtMs({ organizationId: "org_1" }),
    ).resolves.toBe(Date.parse("2026-02-10T09:30:00Z"));
  });

  /** @scenario "An organization that never accepted the price reports no PII redaction spend" */
  it("answers null when no admin accepted it, and for an unknown organization", async () => {
    const repository = repositoryWith(null);

    await expect(
      repository.findPiiRedactionModelAcceptedAtMs({ organizationId: "org_1" }),
    ).resolves.toBeNull();
    await expect(
      repository.findPiiRedactionModelAcceptedAtMs({ organizationId: "org_none" }),
    ).resolves.toBeNull();
  });
});
