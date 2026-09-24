/**
 * Invoicing a mid-term seat change of a connected self-hosted customer
 * (ADR-141, section 7).
 *
 * When an operator raises the seats on a running license, the added seats are
 * billed on their own one-off invoice, prorated over the days of the term that
 * are still to run. Seats that went down are not credited: the annual invoice
 * stands, and the next term is written for the new count.
 *
 * Two rules shape the code. The first is that the change is decided once: the
 * intent row is written before the payment provider is called and completed
 * after it, and the call carries a key derived from the reissued license, so a
 * run that failed halfway invoices the same seats once when the daily tick
 * retries it. The second is that the amount is worked out per seat first and
 * then multiplied, so the unit amount and the quantity on the invoice line
 * multiply back to the total a customer reads.
 *
 * Nothing here reads a database, the environment or the clock directly.
 */

import { createLogger } from "@langwatch/observability";
import type { SeatChangeBillingOutcome } from "../../licensing/registry/issuedLicense";
import type {
  BankTransfer,
  ConnectedBillingAccountRecord,
  ConnectedBillingProvider,
  ConnectedCurrency,
  InvoiceRecord,
} from "./connectedBilling.service";

const logger = createLogger("langwatch:billing:connectedSeatChange");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How the invoicing of one seat change stands. */
export type SeatChangeState = "intent" | "invoiced" | "nothing_to_invoice";

/** What one seat change owes, as stored. */
export interface SeatChangeRecord {
  /** The reissued `IssuedLicense` row the new seat count is signed into. */
  licenseRowId: string;
  accountId: string;
  changedAt: Date;
  addedSeats: number;
  unitAmountCents: number;
  amountCents: number;
  currency: ConnectedCurrency;
  state: SeatChangeState;
  stripeInvoiceId: string | null;
}

export interface SeatChangeStore {
  findAccount(
    organizationId: string,
  ): Promise<ConnectedBillingAccountRecord | null>;
  findAccountById(
    accountId: string,
  ): Promise<ConnectedBillingAccountRecord | null>;
  findSeatChange(licenseRowId: string): Promise<SeatChangeRecord | null>;
  /** Writes the decision for one change, replacing an earlier state of it. */
  recordSeatChange(record: SeatChangeRecord): Promise<void>;
  /** Every change whose invoice was intended but not confirmed. */
  listPendingSeatChanges(): Promise<SeatChangeRecord[]>;
  addInvoice(accountId: string, invoice: InvoiceRecord): Promise<void>;
}

/** The payment provider, narrowed to the one call a seat invoice makes. */
export type SeatChangeInvoicer = Pick<
  ConnectedBillingProvider,
  "createOneOffInvoice"
>;

export interface SeatChangeBillingDeps {
  store: SeatChangeStore;
  provider: SeatChangeInvoicer;
  now: () => Date;
}

/** Whole days from `from` to `to`, floored, negative when `to` comes first. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * What one added seat costs for the rest of the term, in cents.
 *
 * Only the part of the term still to run is charged, counted from the day
 * the seats changed. Rounded to the cent per seat, because that is the unit
 * amount the invoice line carries.
 */
export function proratedSeatUnitAmountCents({
  seatRateCents,
  daysRemaining,
  termDays,
}: {
  seatRateCents: number;
  daysRemaining: number;
  termDays: number;
}): number {
  if (daysRemaining <= 0 || termDays <= 0) return 0;
  return Math.round((seatRateCents * daysRemaining) / termDays);
}

/** The line a customer reads on the invoice. */
function seatInvoiceDescription({
  addedSeats,
  changedAt,
  daysRemaining,
  termDays,
}: {
  addedSeats: number;
  changedAt: Date;
  daysRemaining: number;
  termDays: number;
}): string {
  const day = changedAt.toISOString().slice(0, 10);
  const seats = addedSeats === 1 ? "seat" : "seats";
  return (
    `${addedSeats} ${seats} added on ${day}, ` +
    `charged for the ${daysRemaining} days of the ${termDays} day term that remain`
  );
}

function bankTransferOf(
  account: ConnectedBillingAccountRecord,
): BankTransfer | null {
  if (!account.bankTransferType) return null;
  return {
    type: account.bankTransferType,
    ...(account.bankTransferCountry
      ? { country: account.bankTransferCountry }
      : {}),
  };
}

export class SeatChangeBillingService {
  constructor(private readonly deps: SeatChangeBillingDeps) {}

  /**
   * Invoices the seats a change added. A customer with no billing account
   * gets no invoice from here; finance invoices them by hand.
   */
  async invoiceAddedSeats(input: {
    organizationId: string;
    licenseRowId: string;
    previousSeats: number;
    seats: number;
  }): Promise<SeatChangeBillingOutcome> {
    const account = await this.deps.store.findAccount(input.organizationId);
    if (!account) return "not_onboarded";

    const existing = await this.deps.store.findSeatChange(input.licenseRowId);
    if (existing) {
      if (existing.state === "intent") return await this.complete(existing);
      return existing.state;
    }

    const addedSeats = input.seats - input.previousSeats;
    const changedAt = this.deps.now();
    const daysRemaining = daysBetween(changedAt, account.termEndsAt);
    const termDays = daysBetween(account.termStartsAt, account.termEndsAt);
    const unitAmountCents = proratedSeatUnitAmountCents({
      seatRateCents: account.seatRateCents,
      daysRemaining,
      termDays,
    });
    const amountCents = addedSeats > 0 ? unitAmountCents * addedSeats : 0;

    const record: SeatChangeRecord = {
      licenseRowId: input.licenseRowId,
      accountId: account.id,
      changedAt,
      addedSeats: Math.max(0, addedSeats),
      unitAmountCents,
      amountCents,
      currency: account.seatCurrency,
      state: amountCents > 0 ? "intent" : "nothing_to_invoice",
      stripeInvoiceId: null,
    };
    await this.deps.store.recordSeatChange(record);
    if (record.state === "nothing_to_invoice") return "nothing_to_invoice";

    return await this.complete(record);
  }

  /** Retries every change whose invoice was intended and not confirmed. */
  async completePendingSeatChanges(): Promise<{
    invoiced: number;
    failed: number;
  }> {
    const summary = { invoiced: 0, failed: 0 };
    for (const pending of await this.deps.store.listPendingSeatChanges()) {
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

  /** The provider call for an intent, and the record of what it created. */
  private async complete(
    intent: SeatChangeRecord,
  ): Promise<SeatChangeBillingOutcome> {
    const account = await this.deps.store.findAccountById(intent.accountId);
    if (!account) {
      throw new Error(
        `seat change ${intent.licenseRowId} names an account that no longer exists`,
      );
    }
    const daysRemaining = daysBetween(intent.changedAt, account.termEndsAt);
    const termDays = daysBetween(account.termStartsAt, account.termEndsAt);

    const invoice = await this.deps.provider.createOneOffInvoice({
      customerId: account.stripeCustomerId,
      currency: intent.currency,
      lines: [
        {
          description: seatInvoiceDescription({
            addedSeats: intent.addedSeats,
            changedAt: intent.changedAt,
            daysRemaining,
            termDays,
          }),
          amountCents: intent.amountCents,
          quantity: intent.addedSeats,
          unitAmountCents: intent.unitAmountCents,
        },
      ],
      bankTransfer: bankTransferOf(account),
      metadata: {
        organization_id: account.organizationId,
        kind: "seat_change",
        license_row_id: intent.licenseRowId,
      },
    });

    await this.deps.store.addInvoice(account.id, {
      stripeInvoiceId: invoice.id,
      kind: "seat_change",
      currency: intent.currency,
      amountCents: intent.amountCents,
      status: invoice.status,
      paidOutOfBandAt: null,
      termStartsAt: null,
    });
    await this.deps.store.recordSeatChange({
      ...intent,
      state: "invoiced",
      stripeInvoiceId: invoice.id,
    });
    return "invoiced";
  }
}
