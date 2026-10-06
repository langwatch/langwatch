// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One pass over the seat changes licensing recorded (ARCHITECTURE.md section 9): each is decided
 * once, `not_onboarded` included, then every intent is invoiced once, per seat then multiplied.
 * Spec: specs/self-hosting/connected-services/connected-billing.feature, "Changing seats mid-term".
 */

import type { LicenseSeatChange, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

import type {
  ConnectedInvoicingChannel,
  ProviderInvoice,
} from "../channels/connected-invoicing.channel.ts";
import type {
  ConnectedBillingAccountRecord,
  ConnectedBillingRepository,
  ConnectedSeatChangeRecord,
} from "../repositories/connected-billing.repository.ts";
import {
  daysBetween,
  proratedSeatUnitAmountCents,
  seatInvoiceDescription,
} from "../rules/connected-seat-proration.rules.ts";

const logger = createLogger("langwatch:billing:connectedSeatChange");

/** What one pass did: changes it decided, invoices it raised, and what failed. */
type SeatInvoicingSummary = { decided: number; invoiced: number; failed: number };

export class ConnectedSeatChangeService {
  private constructor(
    private readonly repository: ConnectedBillingRepository,
    private readonly invoicing: ConnectedInvoicingChannel,
    private readonly licensing: Pick<LicensingApi, "findSeatChanges">,
  ) {}

  static create(input: {
    repository: ConnectedBillingRepository;
    invoicing: ConnectedInvoicingChannel;
    licensing: Pick<LicensingApi, "findSeatChanges">;
  }): ConnectedSeatChangeService {
    return new ConnectedSeatChangeService(input.repository, input.invoicing, input.licensing);
  }

  /** One pass: every undecided change is decided, then every intent is invoiced. */
  async invoicePendingSeatChanges(): Promise<SeatInvoicingSummary> {
    const decided = await this.decideNewSeatChanges();
    const { invoiced, failed } = await this.completePendingSeatChanges();
    return { decided: decided.decided, invoiced, failed: decided.failed + failed };
  }

  /** Each change licensing recorded that has no stored decision yet. */
  private async decideNewSeatChanges(): Promise<{ decided: number; failed: number }> {
    const changes = await this.licensing.findSeatChanges({});
    const stored = await this.repository.findSeatChangesByLicenseRows(
      changes.map((change) => change.licenseRowId),
    );
    const known = new Set(stored.map((change) => change.licenseRowId));
    const summary = { decided: 0, failed: 0 };
    for (const change of changes.filter((candidate) => !known.has(candidate.licenseRowId))) {
      try {
        const account = await this.repository.findAccount(change.organizationId);
        const created = await this.repository.createSeatChange(this.decide({ account, change }));
        if (created) summary.decided += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error(
          { licenseRowId: change.licenseRowId, error },
          "seat change could not be decided, retrying on the next pass",
        );
      }
    }
    return summary;
  }

  /** Invoices every change whose invoice was intended and never confirmed. */
  private async completePendingSeatChanges(): Promise<{ invoiced: number; failed: number }> {
    const summary = { invoiced: 0, failed: 0 };
    for (const pending of await this.repository.findPendingSeatChanges()) {
      try {
        await this.complete(pending);
        summary.invoiced += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error(
          { licenseRowId: pending.licenseRowId, error },
          "seat change invoice failed, retrying on the next pass",
        );
      }
    }

    return summary;
  }

  /** What the change owes, before anything is written or invoiced. */
  private decide({
    account,
    change,
  }: {
    account: ConnectedBillingAccountRecord | null;
    change: LicenseSeatChange;
  }): ConnectedSeatChangeRecord {
    const addedSeats = Math.max(0, change.seats - change.previousSeats);
    const changedAt = Temporal.Instant.from(change.changedAt);
    const undecided = {
      licenseRowId: change.licenseRowId,
      organizationId: change.organizationId,
      changedAt,
      addedSeats,
      stripeInvoiceId: null,
    };
    if (!account) {
      return {
        ...undecided,
        accountId: null,
        unitAmountCents: 0,
        amountCents: 0,
        currency: null,
        state: "not_onboarded",
      };
    }

    const unitAmountCents = proratedSeatUnitAmountCents({
      seatRateCents: account.seatRateCents,
      daysRemaining: daysBetween(changedAt, account.termEndsAt),
      termDays: daysBetween(account.termStartsAt, account.termEndsAt),
    });
    const amountCents = unitAmountCents * addedSeats;

    return {
      ...undecided,
      accountId: account.id,
      unitAmountCents,
      amountCents,
      currency: account.seatCurrency,
      state: amountCents > 0 ? "intent" : "nothing_to_invoice",
    };
  }

  /** The provider call for an intent, and the record of what it created. */
  private async complete(intent: ConnectedSeatChangeRecord): Promise<void> {
    const account = intent.accountId
      ? await this.repository.findAccountById(intent.accountId)
      : null;
    if (!account || !intent.currency) {
      throw new Error(`seat change ${intent.licenseRowId} names no account to invoice`);
    }

    const metadata = {
      organization_id: account.organizationId,
      kind: "seat_change",
      license_row_id: intent.licenseRowId,
    };
    const invoice =
      (await this.alreadyRaised({ customerId: account.stripeCustomerId, metadata })) ??
      (await this.invoicing.createOneOffInvoice({
        customerId: account.stripeCustomerId,
        currency: intent.currency,
        lines: [
          {
            description: seatInvoiceDescription({
              addedSeats: intent.addedSeats,
              changedAt: intent.changedAt,
              daysRemaining: daysBetween(intent.changedAt, account.termEndsAt),
              termDays: daysBetween(account.termStartsAt, account.termEndsAt),
            }),
            amountCents: intent.amountCents,
            quantity: intent.addedSeats,
            unitAmountCents: intent.unitAmountCents,
          },
        ],
        bankTransfer: account.bankTransferType
          ? {
              type: account.bankTransferType,
              ...(account.bankTransferCountry ? { country: account.bankTransferCountry } : {}),
            }
          : null,
        metadata,
      }));

    await this.repository.addInvoice(account.id, {
      stripeInvoiceId: invoice.id,
      kind: "seat_change",
      currency: intent.currency,
      amountCents: intent.amountCents,
      status: invoice.status,
      paidOutOfBandAt: null,
      termStartsAt: null,
    });
    await this.repository.recordSeatChange({
      ...intent,
      state: "invoiced",
      stripeInvoiceId: invoice.id,
    });
  }

  /** A finalized invoice an earlier attempt raised; a draft it left is never sent. */
  private async alreadyRaised(input: {
    customerId: string;
    metadata: Record<string, string>;
  }): Promise<ProviderInvoice | undefined> {
    const found = await this.invoicing.findInvoices(input);
    return found.find((invoice) => invoice.status !== "draft");
  }
}
