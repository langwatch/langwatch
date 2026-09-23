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
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";

import type {
  ConnectedBillingAccountRecord,
  ConnectedBillingRepository,
  ConnectedCreditGrantRecord,
} from "../repositories/connected-billing.repository.ts";
import type { ConnectedCustomerFactsService } from "./connected-customer-facts.service.ts";

export class ConnectedBillingOverviewService {
  private constructor(
    private readonly repository: ConnectedBillingRepository,
    private readonly facts: Pick<ConnectedCustomerFactsService, "readContractSpend">,
    private readonly licensing: Pick<LicensingApi, "getContractTerms" | "getConnectedSeats">,
  ) {}

  static create(input: {
    repository: ConnectedBillingRepository;
    facts: Pick<ConnectedCustomerFactsService, "readContractSpend">;
    licensing: Pick<LicensingApi, "getContractTerms" | "getConnectedSeats">;
  }): ConnectedBillingOverviewService {
    return new ConnectedBillingOverviewService(input.repository, input.facts, input.licensing);
  }

  async getOverview({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ConnectedBillingOverview> {
    const account = await this.repository.findAccount(organizationId);
    const [terms, seats, spend, grants, invoices, seatChanges] = await Promise.all([
      this.licensing.getContractTerms({ organizationId }),
      this.licensing.getConnectedSeats({ organizationId }),
      this.facts.readContractSpend(organizationId),
      account ? this.repository.findCreditGrants(account.id) : [],
      account ? this.repository.findInvoices(account.id) : [],
      account ? this.repository.findSeatChangesForAccount(account.id) : [],
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
      seatChanges: seatChanges.map((change) => ({
        licenseId: change.licenseRowId,
        changedAt: change.changedAt.toString(),
        addedSeats: change.addedSeats,
        amountCents: change.amountCents,
        currency: change.currency,
        state: change.state,
        stripeInvoiceId: change.stripeInvoiceId,
      })),
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
