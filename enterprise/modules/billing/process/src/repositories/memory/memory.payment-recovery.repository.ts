// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

import {
  PaymentRecoveryRepository,
  type ClosePaymentRecoveryResult,
  type PaymentRecoveryCase,
} from "../payment-recovery.repository.ts";
import type { BillingSubscriptionRecord } from "../subscription.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

type Operation = "open" | "close" | "advanceNotice" | "findOpen";

/** The recovery columns on the shared store's subscription rows, conditional like the Prisma twin. */
export class MemoryPaymentRecoveryRepository extends PaymentRecoveryRepository {
  private readonly refusals = new Map<Operation, Error>();

  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryPaymentRecoveryRepository {
    return new MemoryPaymentRecoveryRepository(store);
  }

  /** Makes `operation` throw `error` once, as an unreachable database would. */
  refuseOnce({ operation, error }: { operation: Operation; error: Error }): void {
    this.refusals.set(operation, error);
  }

  async open({
    subscriptionId,
    invoiceId,
    startedAt,
  }: {
    subscriptionId: string;
    invoiceId: string;
    startedAt: Instant;
  }): Promise<boolean> {
    this.refused("open");
    const row = this.row(subscriptionId);
    if (!row || row.record.paymentRecoveryStartedAt) return false;
    this.write(row.index, {
      ...row.record,
      paymentRecoveryInvoiceId: invoiceId,
      paymentRecoveryStartedAt: startedAt,
      paymentRecoveryNoticeDay: null,
    });
    return true;
  }

  async close({
    subscriptionId,
    invoiceId,
  }: {
    subscriptionId: string;
    invoiceId?: string;
  }): Promise<ClosePaymentRecoveryResult> {
    this.refused("close");
    const row = this.row(subscriptionId);
    const [open] = row ? casesOf(row.record) : [];
    if (!row || !open) return { outcome: "not_open" };
    if (invoiceId !== undefined && open.invoiceId !== invoiceId) return { outcome: "not_open" };
    this.write(row.index, {
      ...row.record,
      paymentRecoveryInvoiceId: null,
      paymentRecoveryStartedAt: null,
      paymentRecoveryNoticeDay: null,
    });
    return { outcome: "closed", closed: open };
  }

  async advanceNotice({
    subscriptionId,
    from,
    to,
  }: {
    subscriptionId: string;
    from: number | null;
    to: number;
  }): Promise<boolean> {
    this.refused("advanceNotice");
    const row = this.row(subscriptionId);
    if (!row?.record.paymentRecoveryStartedAt) return false;
    if ((row.record.paymentRecoveryNoticeDay ?? null) !== from) return false;
    this.write(row.index, { ...row.record, paymentRecoveryNoticeDay: to });
    return true;
  }

  async findOpen(): Promise<PaymentRecoveryCase[]> {
    this.refused("findOpen");
    return this.openCases(() => true);
  }

  async findOpenForSubscription(subscriptionId: string): Promise<PaymentRecoveryCase[]> {
    return this.openCases((record) => record.id === subscriptionId);
  }

  async findOpenForOrganization(organizationId: string): Promise<PaymentRecoveryCase[]> {
    return this.openCases((record) => record.organizationId === organizationId);
  }

  private openCases(matches: (record: BillingSubscriptionRecord) => boolean) {
    return this.store.subscriptions
      .filter(matches)
      .flatMap(casesOf)
      .toSorted((a, b) => a.startedAt.epochMilliseconds - b.startedAt.epochMilliseconds);
  }

  private refused(operation: Operation): void {
    const refusal = this.refusals.get(operation);
    if (!refusal) return;
    this.refusals.delete(operation);
    throw refusal;
  }

  private row(id: string) {
    const index = this.store.subscriptions.findIndex((record) => record.id === id);
    const record = index < 0 ? undefined : this.store.subscriptions[index];
    return record ? { index, record } : undefined;
  }

  private write(index: number, record: BillingSubscriptionRecord): void {
    this.store.subscriptions[index] = record;
  }
}

/** The case a row holds, as a list of none or one; a closed row holds none. */
function casesOf(record: BillingSubscriptionRecord): PaymentRecoveryCase[] {
  const { paymentRecoveryStartedAt: startedAt, paymentRecoveryInvoiceId: invoiceId } = record;
  if (!startedAt || !invoiceId) return [];
  return [
    {
      subscriptionId: record.id,
      organizationId: record.organizationId,
      plan: record.plan,
      stripeSubscriptionId: record.stripeSubscriptionId,
      invoiceId,
      startedAt,
      noticeDay: record.paymentRecoveryNoticeDay ?? null,
    },
  ];
}
