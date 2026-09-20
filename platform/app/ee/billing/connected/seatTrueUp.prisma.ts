/**
 * Prisma and payment provider bindings for the quarterly seat true-up
 * (ADR-139, section 7), and the one place that builds the service.
 *
 * The walk starts at the license registry rather than at the billing accounts:
 * a license names its customer, and the account is read one organization at a
 * time, so a license belonging to an organization that was never onboarded is
 * simply passed over.
 */

import type Stripe from "stripe";
import type { PrismaClient } from "~/generated/prisma/client";
import { defaultSeatOverageAllowance } from "../../licensing/registry/issuedLicense";
import { createStripeClient } from "../stripe/stripeClient";
import type { BankTransfer } from "./connectedBilling.service";
import { INVOICE_DAYS_UNTIL_DUE } from "./connectedBilling.service";
import type {
  SeatCurrency,
  SeatQuarterPeak,
  SeatTrueUpAccount,
  SeatTrueUpInvoicer,
  SeatTrueUpLicense,
  SeatTrueUpRecord,
  SeatTrueUpStore,
} from "./seatTrueUp.service";
import { ConnectedSeatTrueUpService } from "./seatTrueUp.service";

function bankTransferOf(account: {
  bankTransferType: string | null;
  bankTransferCountry: string | null;
}): BankTransfer | null {
  if (
    account.bankTransferType !== "us_bank_transfer" &&
    account.bankTransferType !== "eu_bank_transfer"
  ) {
    return null;
  }
  return {
    type: account.bankTransferType,
    ...(account.bankTransferCountry
      ? { country: account.bankTransferCountry }
      : {}),
  };
}

export class PrismaSeatTrueUpStore implements SeatTrueUpStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listLicenses(): Promise<SeatTrueUpLicense[]> {
    const rows = await this.prisma.issuedLicense.findMany({
      where: {
        revokedAt: null,
        supersededAt: null,
        NOT: { organizationId: null },
      },
      select: {
        id: true,
        organizationId: true,
        issuedAt: true,
        maxMembers: true,
        seatOverageAllowance: true,
        lastSyncAt: true,
      },
    });

    return rows.flatMap((row) =>
      row.organizationId
        ? [
            {
              id: row.id,
              organizationId: row.organizationId,
              issuedAt: row.issuedAt,
              maxMembers: row.maxMembers,
              seatOverageAllowance:
                row.seatOverageAllowance ??
                defaultSeatOverageAllowance(row.maxMembers),
              lastSyncAt: row.lastSyncAt,
            },
          ]
        : [],
    );
  }

  async findAccount(organizationId: string): Promise<SeatTrueUpAccount | null> {
    const row = await this.prisma.connectedBillingAccount.findUnique({
      where: { organizationId },
      select: {
        id: true,
        stripeCustomerId: true,
        seatCurrency: true,
        seatRateCents: true,
        seats: true,
        termStartsAt: true,
        termEndsAt: true,
        bankTransferType: true,
        bankTransferCountry: true,
      },
    });
    if (!row) return null;

    return {
      id: row.id,
      stripeCustomerId: row.stripeCustomerId,
      seatCurrency: row.seatCurrency as SeatCurrency,
      seatRateCents: row.seatRateCents,
      seats: row.seats,
      termStartsAt: row.termStartsAt,
      termEndsAt: row.termEndsAt,
      bankTransfer: bankTransferOf(row),
    };
  }

  async findPeak(key: {
    licenseId: string;
    quarterStartsAt: Date;
  }): Promise<SeatQuarterPeak | null> {
    const row = await this.prisma.licenseSeatReport.findUnique({
      where: { licenseId_quarterStartsAt: key },
      select: { peakMembers: true, lastReportedAt: true },
    });
    return row
      ? { peakMembers: row.peakMembers, lastReportedAt: row.lastReportedAt }
      : null;
  }

  async findDecisions(licenseId: string): Promise<SeatTrueUpRecord[]> {
    const rows = await this.prisma.connectedSeatTrueUp.findMany({
      where: { licenseId },
      orderBy: { quarterStartsAt: "asc" },
    });
    return rows.map((row) => ({
      licenseId: row.licenseId,
      quarterStartsAt: row.quarterStartsAt,
      peakSeats: row.peakSeats,
      addedSeats: row.addedSeats,
      amountCents: row.amountCents,
      currency: row.currency as SeatCurrency,
      state: row.state,
      stripeInvoiceId: row.stripeInvoiceId,
    }));
  }

  async record(record: SeatTrueUpRecord): Promise<void> {
    const { licenseId, quarterStartsAt, ...rest } = record;
    await this.prisma.connectedSeatTrueUp.upsert({
      where: { licenseId_quarterStartsAt: { licenseId, quarterStartsAt } },
      create: { licenseId, quarterStartsAt, ...rest },
      update: rest,
    });
  }
}

/**
 * The seat invoice at the payment provider, and the record of it on this side.
 *
 * It is a one-off invoice with no subscription on it, which is what keeps the
 * usage commit out of reach: a credit grant applies to metered subscription
 * items and to nothing else. The line carries a quantity and a unit amount, so
 * the customer reads "8 seats at 300.82" rather than one total.
 */
export class StripeSeatTrueUpInvoicer implements SeatTrueUpInvoicer {
  constructor(
    private readonly deps: { stripe: Stripe; prisma: PrismaClient },
  ) {}

  async invoiceAddedSeats(input: {
    accountId: string;
    quarterStartsAt: Date;
    stripeCustomerId: string;
    bankTransfer: BankTransfer | null;
    currency: SeatCurrency;
    unitAmountCents: number;
    addedSeats: number;
    amountCents: number;
    description: string;
    idempotencyKey: string;
  }): Promise<{ invoiceId: string }> {
    const currency = input.currency.toLowerCase();

    // The draft comes first and the line names it, so a pending item left by
    // another invoice in flight for the same customer never rides along.
    const draft = await this.deps.stripe.invoices.create(
      {
        customer: input.stripeCustomerId,
        currency,
        collection_method: "send_invoice",
        days_until_due: INVOICE_DAYS_UNTIL_DUE,
        pending_invoice_items_behavior: "exclude",
        auto_advance: false,
        metadata: { langwatch_seat_true_up: input.idempotencyKey },
        ...paymentSettingsOf(input.bankTransfer),
      },
      { idempotencyKey: `${input.idempotencyKey}:invoice` },
    );

    await this.deps.stripe.invoiceItems.create(
      {
        customer: input.stripeCustomerId,
        invoice: draft.id,
        currency,
        quantity: input.addedSeats,
        unit_amount: input.unitAmountCents,
        description: input.description,
        metadata: { langwatch_seat_true_up: input.idempotencyKey },
      },
      { idempotencyKey: `${input.idempotencyKey}:item` },
    );

    const finalized = await this.deps.stripe.invoices.finalizeInvoice(
      draft.id,
      undefined,
      { idempotencyKey: `${input.idempotencyKey}:finalize` },
    );

    await this.deps.prisma.connectedInvoice.upsert({
      where: { stripeInvoiceId: finalized.id },
      create: {
        accountId: input.accountId,
        stripeInvoiceId: finalized.id,
        kind: "seat_trueup",
        currency: input.currency,
        amountCents: input.amountCents,
        status: finalized.status ?? "draft",
        quarterStartsAt: input.quarterStartsAt,
      },
      update: { status: finalized.status ?? "draft" },
    });

    return { invoiceId: finalized.id };
  }
}

/**
 * Bank transfer needs `send_invoice`, which this already is. The type is the
 * customer's: a US dollar account takes `us_bank_transfer`, a euro account
 * `eu_bank_transfer` and the country it is held in.
 */
function paymentSettingsOf(bankTransfer: BankTransfer | null) {
  if (!bankTransfer) return {};
  return {
    payment_settings: {
      payment_method_types: ["customer_balance" as const],
      payment_method_options: {
        customer_balance: {
          funding_type: "bank_transfer" as const,
          bank_transfer: {
            type: bankTransfer.type,
            ...(bankTransfer.country
              ? { eu_bank_transfer: { country: bankTransfer.country } }
              : {}),
          },
        },
      },
    },
  };
}

export function createConnectedSeatTrueUpService(
  prisma: PrismaClient,
): ConnectedSeatTrueUpService {
  return new ConnectedSeatTrueUpService({
    store: new PrismaSeatTrueUpStore(prisma),
    invoicer: new StripeSeatTrueUpInvoicer({
      stripe: createStripeClient(),
      prisma,
    }),
    now: () => new Date(),
  });
}
