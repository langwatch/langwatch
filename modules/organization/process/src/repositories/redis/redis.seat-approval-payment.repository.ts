import type { SeatPayment } from "@langwatch/enterprise-billing-contract";
import type { RedisConnection } from "@langwatch/redis-client";

import type {
  SeatApprovalOpening,
  SeatApprovalPaymentRepository,
} from "../seat-approval-payment.repository.ts";

const PREFIX = "organization:seat-approval-payment";
/** An unpaid seat invoice is void within a day and a checkout expires the same day. */
const KEEP_SECONDS = 7 * 24 * 60 * 60;

/** The seat payments approvals wait on, in process Redis with a week's expiry. */
export class RedisSeatApprovalPaymentRepository implements SeatApprovalPaymentRepository {
  static create(redis: RedisConnection): RedisSeatApprovalPaymentRepository {
    return new RedisSeatApprovalPaymentRepository(redis);
  }

  private constructor(private readonly redis: RedisConnection) {}

  async save({
    payment,
    ...opening
  }: SeatApprovalOpening & { payment: SeatPayment }): Promise<void> {
    await this.redis.set(keyOf(opening), JSON.stringify(payment), "EX", KEEP_SECONDS);
  }

  async find(opening: SeatApprovalOpening): Promise<SeatPayment[]> {
    const raw = await this.redis.get(keyOf(opening));
    return raw ? [JSON.parse(raw) as SeatPayment] : [];
  }
}

/** The organization in braces is the Cluster hash tag, as the other organization keys use. */
function keyOf({ organizationId, seatRequestId, openedAt }: SeatApprovalOpening): string {
  return `${PREFIX}:{${organizationId}}:${seatRequestId}:${openedAt}`;
}
