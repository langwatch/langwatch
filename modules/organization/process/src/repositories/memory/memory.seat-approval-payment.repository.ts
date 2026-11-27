import type { SeatPayment } from "@langwatch/enterprise-billing-contract";

import type {
  SeatApprovalOpening,
  SeatApprovalPaymentRepository,
} from "../seat-approval-payment.repository.ts";

/** The seat payments approvals wait on, held in the process. */
export class MemorySeatApprovalPaymentRepository implements SeatApprovalPaymentRepository {
  private readonly payments = new Map<string, SeatPayment>();

  static create(): MemorySeatApprovalPaymentRepository {
    return new MemorySeatApprovalPaymentRepository();
  }

  private constructor() {}

  async save({
    payment,
    ...opening
  }: SeatApprovalOpening & { payment: SeatPayment }): Promise<void> {
    this.payments.set(keyOf(opening), payment);
  }

  async find(opening: SeatApprovalOpening): Promise<SeatPayment[]> {
    const payment = this.payments.get(keyOf(opening));
    return payment ? [payment] : [];
  }
}

function keyOf({ organizationId, seatRequestId, openedAt }: SeatApprovalOpening): string {
  return `${organizationId}:${seatRequestId}:${openedAt}`;
}
