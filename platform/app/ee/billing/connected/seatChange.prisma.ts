/**
 * Prisma and payment provider bindings for seat change invoicing (ADR-141,
 * section 7), and the one place that builds the service.
 *
 * The registry calls this from every deployment, including a self-hosted
 * install that has no payment provider key, so the provider is built on the
 * first change that has an account to invoice rather than when the registry
 * is.
 */

import type { PrismaClient } from "~/generated/prisma/client";
import type { SeatChangeBillingPort } from "../../licensing/registry/issuedLicense";
import { createCreditGrants } from "../stripe/creditGrants";
import { createStripeClient } from "../stripe/stripeClient";
import { prices } from "../stripe/stripePriceCatalog";
import type {
  ConnectedBillingAccountRecord,
  ConnectedCurrency,
  InvoiceRecord,
} from "./connectedBilling.service";
import { StripeConnectedBillingProvider } from "./connectedBilling.stripe";
import { PrismaConnectedBillingStore } from "./connectedBillingStore.prisma";
import {
  SeatChangeBillingService,
  type SeatChangeInvoicer,
  type SeatChangeRecord,
  type SeatChangeStore,
} from "./seatChange.service";

export class PrismaSeatChangeStore implements SeatChangeStore {
  private readonly billing: PrismaConnectedBillingStore;

  constructor(private readonly prisma: PrismaClient) {
    this.billing = new PrismaConnectedBillingStore(prisma);
  }

  findAccount(
    organizationId: string,
  ): Promise<ConnectedBillingAccountRecord | null> {
    return this.billing.findAccount(organizationId);
  }

  findAccountById(
    accountId: string,
  ): Promise<ConnectedBillingAccountRecord | null> {
    return this.billing.findAccountById(accountId);
  }

  addInvoice(accountId: string, invoice: InvoiceRecord): Promise<void> {
    return this.billing.addInvoice(accountId, invoice);
  }

  async findSeatChange(licenseRowId: string): Promise<SeatChangeRecord | null> {
    const row = await this.prisma.connectedSeatChange.findUnique({
      where: { licenseId: licenseRowId },
    });
    return row ? toRecord(row) : null;
  }

  async recordSeatChange(record: SeatChangeRecord): Promise<void> {
    const { licenseRowId, ...rest } = record;
    await this.prisma.connectedSeatChange.upsert({
      where: { licenseId: licenseRowId },
      create: { licenseId: licenseRowId, ...rest },
      update: rest,
    });
  }

  async listPendingSeatChanges(): Promise<SeatChangeRecord[]> {
    const rows = await this.prisma.connectedSeatChange.findMany({
      where: { state: "intent" },
      orderBy: { changedAt: "asc" },
    });
    return rows.map(toRecord);
  }
}

function toRecord(row: {
  licenseId: string;
  accountId: string;
  changedAt: Date;
  addedSeats: number;
  unitAmountCents: number;
  amountCents: number;
  currency: string;
  state: SeatChangeRecord["state"];
  stripeInvoiceId: string | null;
}): SeatChangeRecord {
  return {
    licenseRowId: row.licenseId,
    accountId: row.accountId,
    changedAt: row.changedAt,
    addedSeats: row.addedSeats,
    unitAmountCents: row.unitAmountCents,
    amountCents: row.amountCents,
    currency: row.currency as ConnectedCurrency,
    state: row.state,
    stripeInvoiceId: row.stripeInvoiceId,
  };
}

/** The provider, built once and only when a call needs it. */
function lazyInvoicer(): SeatChangeInvoicer {
  let provider: StripeConnectedBillingProvider | undefined;
  return {
    createOneOffInvoice: (input) => {
      if (!provider) {
        const stripe = createStripeClient();
        provider = new StripeConnectedBillingProvider({
          stripe,
          creditGrants: createCreditGrants(stripe),
          usagePriceId: () => prices.CONNECTED_HOSTED_USAGE_QUARTERLY,
        });
      }
      return provider.createOneOffInvoice(input);
    },
  };
}

export function createSeatChangeBilling(
  prisma: PrismaClient,
): SeatChangeBillingService & SeatChangeBillingPort {
  return new SeatChangeBillingService({
    store: new PrismaSeatChangeStore(prisma),
    provider: lazyInvoicer(),
    now: () => new Date(),
  });
}
