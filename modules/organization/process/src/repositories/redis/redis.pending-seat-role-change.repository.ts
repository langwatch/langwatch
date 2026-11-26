import type { SeatRoleChangeStatus } from "@langwatch/organization-contract";
import type { RedisConnection } from "@langwatch/redis-client";

import { paymentKey, type SeatPaymentRef } from "../../rules/seat-role-change.rules.ts";
import type {
  PendingSeatRoleChangeRecord,
  PendingSeatRoleChangeRepository,
} from "../pending-seat-role-change.repository.ts";

const PREFIX = "organization:seat-role-change";
const KEEP_SECONDS = 7 * 24 * 60 * 60;
/** Long enough for one role write; a crashed applier frees the change after it. */
const CLAIM_SECONDS = 120;

/** The changes waiting on a seat payment, in process Redis with a week's expiry. */
export class RedisPendingSeatRoleChangeRepository implements PendingSeatRoleChangeRepository {
  static create(redis: RedisConnection): RedisPendingSeatRoleChangeRepository {
    return new RedisPendingSeatRoleChangeRepository(redis);
  }

  private constructor(private readonly redis: RedisConnection) {}

  async save(record: PendingSeatRoleChangeRecord): Promise<boolean> {
    const payment = `${PREFIX}:payment:${paymentKey(record.payment)}`;
    const taken = await this.redis.set(payment, record.id, "EX", KEEP_SECONDS, "NX");
    if (taken !== "OK") return false;
    await this.redis
      .multi()
      .set(recordKey(record.id), JSON.stringify(record), "EX", KEEP_SECONDS)
      .set(memberKey(record), record.id, "EX", KEEP_SECONDS)
      .set(organizationKey(record), record.id, "EX", KEEP_SECONDS)
      .exec();
    return true;
  }

  async findById({ id }: { id: string }): Promise<PendingSeatRoleChangeRecord[]> {
    const raw = await this.redis.get(recordKey(id));
    return raw ? [JSON.parse(raw) as PendingSeatRoleChangeRecord] : [];
  }

  async findByPayment({
    payment,
  }: {
    payment: SeatPaymentRef;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const id = await this.redis.get(`${PREFIX}:payment:${paymentKey(payment)}`);
    return id ? this.findById({ id }) : [];
  }

  async findLatestForMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const id = await this.redis.get(memberKey(input));
    return id ? this.findById({ id }) : [];
  }

  async findWaitingForOrganization(input: {
    organizationId: string;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const id = await this.redis.get(organizationKey(input));
    const found = id ? await this.findById({ id }) : [];
    return found.filter((record) => record.status === "waiting");
  }

  async claim({ id }: { id: string }): Promise<boolean> {
    const taken = await this.redis.set(`${recordKey(id)}:claim`, "1", "EX", CLAIM_SECONDS, "NX");
    return taken === "OK";
  }

  async release({ id }: { id: string }): Promise<void> {
    await this.redis.del(`${recordKey(id)}:claim`);
  }

  async settle({
    id,
    status,
    reason,
  }: {
    id: string;
    status: Exclude<SeatRoleChangeStatus, "waiting">;
    reason?: string;
  }): Promise<void> {
    const [record] = await this.findById({ id });
    if (!record) return;
    const settled = { ...record, status, reason: reason ?? null };
    await this.redis.set(recordKey(id), JSON.stringify(settled), "KEEPTTL", "XX");
  }
}

function recordKey(id: string): string {
  return `${PREFIX}:${id}`;
}

function organizationKey({ organizationId }: { organizationId: string }): string {
  return `${PREFIX}:organization:${organizationId}`;
}

function memberKey({ organizationId, userId }: { organizationId: string; userId: string }): string {
  return `${PREFIX}:member:${organizationId}:${userId}`;
}
