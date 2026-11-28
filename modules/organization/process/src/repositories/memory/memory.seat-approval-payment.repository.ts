import type { SeatPayment } from "@langwatch/enterprise-billing-contract";
import { nowInstant } from "@langwatch/time";

import type {
  SeatApprovalOpening,
  SeatApprovalPaymentRepository,
} from "../seat-approval-payment.repository.ts";

/** A week, as long as the Redis twin keeps a payment. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** The seat payments approvals wait on, held in the process for a week. */
export class MemorySeatApprovalPaymentRepository implements SeatApprovalPaymentRepository {
  private readonly payments = new Map<string, { payment: SeatPayment; expiresAt: number }>();

  static create({
    now = () => nowInstant().epochMilliseconds,
  }: { now?: () => number } = {}): MemorySeatApprovalPaymentRepository {
    return new MemorySeatApprovalPaymentRepository(now);
  }

  private constructor(private readonly now: () => number) {}

  async save({
    payment,
    ...opening
  }: SeatApprovalOpening & { payment: SeatPayment }): Promise<void> {
    this.payments.set(keyOf(opening), { payment, expiresAt: this.now() + KEEP_MS });
  }

  async find(opening: SeatApprovalOpening): Promise<SeatPayment[]> {
    const kept = this.payments.get(keyOf(opening));
    return kept && kept.expiresAt > this.now() ? [kept.payment] : [];
  }
}

function keyOf({ organizationId, seatRequestId, openedAt }: SeatApprovalOpening): string {
  return `${organizationId}:${seatRequestId}:${openedAt}`;
}
