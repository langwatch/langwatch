// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Invoicing a mid-term seat change of a connected self-hosted customer
 * (ADR-156 section 7).
 *
 * Two rules shape this. The change is decided once: the intent is written
 * before the provider is called and completed after it, and the call carries a
 * key derived from the reissued license, so a run that failed halfway invoices
 * the same seats once when the daily tick retries it. And the amount is worked
 * out per seat first and then multiplied, so the unit amount and the quantity
 * on the invoice line multiply back to the total a customer reads.
 */

import type { SeatChangeBillingOutcome } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { ConnectedInvoicingChannel } from "../channels/connected-invoicing.channel.ts";
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

export class ConnectedSeatChangeService {
  private constructor(
    private readonly repository: ConnectedBillingRepository,
    private readonly invoicing: ConnectedInvoicingChannel,
    private readonly now: () => Instant,
  ) {}

  static create(input: {
    repository: ConnectedBillingRepository;
    invoicing: ConnectedInvoicingChannel;
    now?: () => Instant;
  }): ConnectedSeatChangeService {
    return new ConnectedSeatChangeService(
      input.repository,
      input.invoicing,
      input.now ?? nowInstant,
    );
  }

  /**
   * Invoices the seats a change added. A customer with no billing account gets
   * no invoice from here; finance invoices them by hand, and the operator is
   * told so.
   */
  async invoiceAddedSeats(input: {
    organizationId: string;
    licenseRowId: string;
    previousSeats: number;
    seats: number;
  }): Promise<SeatChangeBillingOutcome> {
    const account = await this.repository.findAccount(input.organizationId);
    if (!account) return "not_onboarded";

    const existing = await this.repository.findSeatChange(input.licenseRowId);
    if (existing) {
      return existing.state === "intent" ? await this.complete(existing) : existing.state;
    }

    const record = this.decide({ account, ...input });
    await this.repository.recordSeatChange(record);
    if (record.state === "nothing_to_invoice") return "nothing_to_invoice";

    return this.complete(record);
  }

  /** Retries every change whose invoice was intended and never confirmed. */
  async completePendingSeatChanges(): Promise<{ invoiced: number; failed: number }> {
    const summary = { invoiced: 0, failed: 0 };
    for (const pending of await this.repository.findPendingSeatChanges()) {
      try {
        await this.complete(pending);
        summary.invoiced += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error(
          { licenseRowId: pending.licenseRowId, error },
          "seat change invoice failed, retrying on the next tick",
        );
      }
    }

    return summary;
  }

  /** What the change owes, before anything is written or invoiced. */
  private decide({
    account,
    licenseRowId,
    previousSeats,
    seats,
  }: {
    account: ConnectedBillingAccountRecord;
    licenseRowId: string;
    previousSeats: number;
    seats: number;
  }): ConnectedSeatChangeRecord {
    const addedSeats = seats - previousSeats;
    const changedAt = this.now();
    const unitAmountCents = proratedSeatUnitAmountCents({
      seatRateCents: account.seatRateCents,
      daysRemaining: daysBetween(changedAt, account.termEndsAt),
      termDays: daysBetween(account.termStartsAt, account.termEndsAt),
    });
    const amountCents = addedSeats > 0 ? unitAmountCents * addedSeats : 0;

    return {
      licenseRowId,
      accountId: account.id,
      changedAt,
      addedSeats: Math.max(0, addedSeats),
      unitAmountCents,
      amountCents,
      currency: account.seatCurrency,
      state: amountCents > 0 ? "intent" : "nothing_to_invoice",
      stripeInvoiceId: null,
    };
  }

  /** The provider call for an intent, and the record of what it created. */
  private async complete(intent: ConnectedSeatChangeRecord): Promise<SeatChangeBillingOutcome> {
    const account = await this.repository.findAccountById(intent.accountId);
    if (!account) {
      throw new Error(`seat change ${intent.licenseRowId} names an account that no longer exists`);
    }

    const bankTransfer = account.bankTransferType
      ? {
          type: account.bankTransferType,
          ...(account.bankTransferCountry ? { country: account.bankTransferCountry } : {}),
        }
      : null;
    const invoice = await this.invoicing.createOneOffInvoice({
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
      bankTransfer,
      metadata: {
        organization_id: account.organizationId,
        kind: "seat_change",
        license_row_id: intent.licenseRowId,
      },
    });

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

    return "invoiced";
  }
}
