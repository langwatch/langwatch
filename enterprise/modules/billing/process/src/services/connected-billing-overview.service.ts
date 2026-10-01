// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the backoffice shows about a connected customer's commercial state
 * (ADR-156 section 7). The drawdown comes from LangWatch's own budget ledger,
 * never the payment provider's credit balance, which settles only when an
 * invoice is finalized; unread, it is null and the screen says so.
 */

import type {
  ConnectedBillingAccountView,
  ConnectedBillingOverview,
  ConnectedCreditGrantView,
} from "@langwatch/enterprise-billing-contract";
import type { LicenseSeatChange, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { Temporal } from "@langwatch/time";

import type {
  ConnectedBillingAccountRecord,
  ConnectedBillingRepository,
  ConnectedCreditGrantRecord,
  ConnectedSeatChangeRecord,
} from "../repositories/connected-billing.repository.ts";
import type { ConnectedCustomerFactsService } from "./connected-customer-facts.service.ts";

export class ConnectedBillingOverviewService {
  private constructor(
    private readonly repository: ConnectedBillingRepository,
    private readonly facts: Pick<ConnectedCustomerFactsService, "readContractSpend">,
    private readonly licensing: OverviewLicensing,
  ) {}

  static create(input: {
    repository: ConnectedBillingRepository;
    facts: Pick<ConnectedCustomerFactsService, "readContractSpend">;
    licensing: OverviewLicensing;
  }): ConnectedBillingOverviewService {
    return new ConnectedBillingOverviewService(input.repository, input.facts, input.licensing);
  }

  async getOverview({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ConnectedBillingOverview> {
    const account = await this.repository.findAccount(organizationId);
    const [terms, seats, spend, grants, invoices, decided, recorded] = await Promise.all([
      this.licensing.getContractTerms({ organizationId }),
      this.licensing.getConnectedSeats({ organizationId }),
      this.facts.readContractSpend(organizationId),
      account ? this.repository.findCreditGrants(account.id) : [],
      account ? this.repository.findInvoices(account.id) : [],
      this.repository.findSeatChangesForOrganization({
        organizationId,
        accountId: account?.id ?? null,
      }),
      this.licensing.findSeatChanges({ organizationId }),
    ]);

    return {
      account: account ? accountView(account) : null,
      grants: grants.map(creditGrantView),
      invoices: invoices.map((invoice) => ({
        stripeInvoiceId: invoice.stripeInvoiceId,
        kind: invoice.kind,
        currency: invoice.currency,
        amountCents: invoice.amountCents,
        status: invoice.status,
        paidOutOfBandAt: invoice.paidOutOfBandAt?.toString() ?? null,
      })),
      spend,
      terms: {
        commitUsdCents: terms.commitUsdCents,
        maximumUsdCents: terms.maximumUsdCents,
        overageEnabled: terms.overageEnabled,
      },
      seats: { licensed: seats.licensed, reported: seats.reported, lastSyncAt: seats.lastSyncAt },
      seatChanges: seatChangeViews({ decided, recorded }),
    };
  }

  /** An account as the backoffice reads it back after a command. */
  viewAccount(account: ConnectedBillingAccountRecord): ConnectedBillingAccountView {
    return accountView(account);
  }

  viewCreditGrant(grant: ConnectedCreditGrantRecord): ConnectedCreditGrantView {
    return creditGrantView(grant);
  }
}

type SeatChangeView = ConnectedBillingOverview["seatChanges"][number];

type OverviewLicensing = Pick<
  LicensingApi,
  "getContractTerms" | "getConnectedSeats" | "findSeatChanges"
>;

/** Every decided change, and each change licensing recorded that billing has not decided yet. */
function seatChangeViews({
  decided,
  recorded,
}: {
  decided: ConnectedSeatChangeRecord[];
  recorded: LicenseSeatChange[];
}): SeatChangeView[] {
  const known = new Set(decided.map((change) => change.licenseRowId));
  const views: SeatChangeView[] = [
    ...decided.map((change): SeatChangeView => ({
      licenseId: change.licenseRowId,
      changedAt: change.changedAt.toString(),
      addedSeats: change.addedSeats,
      amountCents: change.amountCents,
      currency: change.currency,
      state: change.state,
      stripeInvoiceId: change.stripeInvoiceId,
    })),
    ...recorded
      .filter((change) => !known.has(change.licenseRowId))
      .map((change): SeatChangeView => ({
        licenseId: change.licenseRowId,
        changedAt: Temporal.Instant.from(change.changedAt).toString(),
        addedSeats: Math.max(0, change.seats - change.previousSeats),
        amountCents: 0,
        currency: null,
        state: "awaiting",
        stripeInvoiceId: null,
      })),
  ];
  return views.toSorted((a, b) =>
    Temporal.Instant.compare(
      Temporal.Instant.from(b.changedAt),
      Temporal.Instant.from(a.changedAt),
    ),
  );
}

function accountView(account: ConnectedBillingAccountRecord): ConnectedBillingAccountView {
  return {
    id: account.id,
    organizationId: account.organizationId,
    stripeCustomerId: account.stripeCustomerId,
    termStartsAt: account.termStartsAt.toString(),
    termEndsAt: account.termEndsAt.toString(),
    commitUsdCents: account.commitUsdCents,
    seatCurrency: account.seatCurrency,
    seatRateCents: account.seatRateCents,
    seats: account.seats,
    bankTransferType: account.bankTransferType,
    bankTransferCountry: account.bankTransferCountry,
    billingEmail: account.billingEmail,
    renewalPending: account.pendingRenewal !== null,
  };
}

function creditGrantView(grant: ConnectedCreditGrantRecord): ConnectedCreditGrantView {
  return {
    stripeCreditGrantId: grant.stripeCreditGrantId,
    amountUsdCents: grant.amountUsdCents,
    kind: grant.kind,
    termEndsAt: grant.termEndsAt.toString(),
    expiresAt: grant.expiresAt.toString(),
  };
}
