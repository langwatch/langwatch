/** @see specs/self-hosting/connected-services/connected-billing.feature */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { SeatChangeOrganizationBackfillService } from "../../features/connected-billing/services/seat-change-organization-backfill.service.ts";
import type {
  ConnectedBillingAccountRecord,
  ConnectedSeatChangeRecord,
} from "../../repositories/connected-billing.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryConnectedBillingRepository } from "../../repositories/memory/memory.connected-billing.repository.ts";

const at = Temporal.Instant.from("2026-07-04T10:00:00Z");

const account = {
  id: "acct-1",
  organizationId: "org-1",
  stripeCustomerId: "cus_1",
  usageSubscriptionId: null,
  usageSubscriptionItemId: null,
  termStartsAt: at,
  termEndsAt: at,
  commitUsdCents: 0,
  seatCurrency: "USD",
  seatRateCents: 0,
  seats: 1,
  bankTransferType: null,
  bankTransferCountry: null,
  billingEmail: "finance@customer.example",
  pendingRenewal: null,
} satisfies ConnectedBillingAccountRecord;

const change = (licenseRowId: string, patch: Partial<ConnectedSeatChangeRecord> = {}) =>
  ({
    licenseRowId,
    accountId: "acct-1",
    organizationId: null,
    changedAt: at,
    addedSeats: 1,
    unitAmountCents: 100,
    amountCents: 100,
    currency: "USD",
    state: "invoiced",
    stripeInvoiceId: null,
    ...patch,
  }) satisfies ConnectedSeatChangeRecord;

function harness() {
  const store = MemoryBillingStore.create();
  store.connectedBillingAccounts.set(account.organizationId, account);
  for (const each of [
    change("lic-1"),
    change("lic-2"),
    change("lic-3", { accountId: null, organizationId: "org-2", state: "not_onboarded" }),
  ]) {
    store.connectedSeatChanges.set(each.licenseRowId, each);
  }
  const service = SeatChangeOrganizationBackfillService.create({
    repository: MemoryConnectedBillingRepository.create(store),
  });
  const saved: string[] = [];
  const run = ({
    dryRun = false,
    after = null,
  }: { dryRun?: boolean; after?: string | null } = {}) =>
    service.backfill({
      after,
      dryRun,
      signal: new AbortController().signal,
      onBatch: async (batch) => void saved.push(batch.afterLicenseRowId),
    });
  const organizations = () =>
    [...store.connectedSeatChanges.values()].map((each) => each.organizationId);

  return { run, saved, organizations };
}

describe("filling the organization on seat changes recorded before the column", () => {
  /** @scenario "Seat changes recorded before they named their organization are filled in the background" */
  it("names each change's organization from its account, once", async () => {
    const { run, saved, organizations } = harness();

    await expect(run()).resolves.toEqual({ filled: 2, afterLicenseRowId: "lic-2" });
    expect(organizations()).toEqual(["org-1", "org-1", "org-2"]);
    expect(saved).toEqual(["lic-2"]);
    await expect(run()).resolves.toEqual({ filled: 0, afterLicenseRowId: null });
  });

  it("writes nothing and saves no checkpoint on a dry run", async () => {
    const { run, saved, organizations } = harness();

    await expect(run({ dryRun: true })).resolves.toEqual({ filled: 2, afterLicenseRowId: "lic-2" });
    expect(organizations()).toEqual([null, null, "org-2"]);
    expect(saved).toEqual([]);
  });

  it("resumes after the checkpointed license row", async () => {
    const { run, organizations } = harness();

    await expect(run({ after: "lic-1" })).resolves.toEqual({
      filled: 1,
      afterLicenseRowId: "lic-2",
    });
    expect(organizations()).toEqual([null, "org-1", "org-2"]);
  });
});
