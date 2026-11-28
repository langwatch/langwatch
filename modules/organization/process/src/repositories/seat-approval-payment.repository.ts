import type { SeatPayment } from "@langwatch/enterprise-billing-contract";

/** One opening of one seat request: a request answered and asked again is a new opening. */
export type SeatApprovalOpening = Readonly<{
  organizationId: string;
  seatRequestId: string;
  /** Epoch milliseconds the request opened at. */
  openedAt: number;
}>;

/**
 * The seat payment an approval with a seat waits on, kept by the opening it was bought for so
 * completing the approval settles that payment and no other (seat-requests.feature).
 */
export interface SeatApprovalPaymentRepository {
  /** Keeps the payment for the opening, replacing one an earlier approval of it kept. */
  save(input: SeatApprovalOpening & { payment: SeatPayment }): Promise<void>;
  /** The payment kept for the opening, or none once it expired or was never kept. */
  find(input: SeatApprovalOpening): Promise<SeatPayment[]>;
}
