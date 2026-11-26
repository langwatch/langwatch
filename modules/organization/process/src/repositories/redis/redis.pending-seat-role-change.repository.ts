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
/** Reserves the payment and writes the record and both indexes in one step, or writes nothing. */
const SAVE_SCRIPT =
  "if not redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3], 'NX') then return 0 end " +
  "redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3]) " +
  "redis.call('SET', KEYS[3], ARGV[1], 'EX', ARGV[3]) " +
  "redis.call('SET', KEYS[4], ARGV[1], 'EX', ARGV[3]) " +
  "return 1";
const RELEASE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

/** The changes waiting on a seat payment, in process Redis with a week's expiry. */
export class RedisPendingSeatRoleChangeRepository implements PendingSeatRoleChangeRepository {
  static create(redis: RedisConnection): RedisPendingSeatRoleChangeRepository {
    return new RedisPendingSeatRoleChangeRepository(redis);
  }

  private constructor(private readonly redis: RedisConnection) {}

  async save(record: PendingSeatRoleChangeRecord): Promise<boolean> {
    const payment = `${PREFIX}:payment:${paymentKey(record.payment)}`;
    const saved = await this.redis.eval(
      SAVE_SCRIPT,
      4,
      payment,
      recordKey(record.id),
      memberKey(record),
      organizationKey(record),
      record.id,
      JSON.stringify(record),
      KEEP_SECONDS,
    );
    return saved === 1;
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

  async claim({ id, token }: { id: string; token: string }): Promise<boolean> {
    const taken = await this.redis.set(claimKey(id), token, "EX", CLAIM_SECONDS, "NX");
    return taken === "OK";
  }

  async holds({ id, token }: { id: string; token: string }): Promise<boolean> {
    return (await this.redis.get(claimKey(id))) === token;
  }

  async release({ id, token }: { id: string; token: string }): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, claimKey(id), token);
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

function claimKey(id: string): string {
  return `${recordKey(id)}:claim`;
}

function organizationKey({ organizationId }: { organizationId: string }): string {
  return `${PREFIX}:organization:${organizationId}`;
}

function memberKey({ organizationId, userId }: { organizationId: string; userId: string }): string {
  return `${PREFIX}:member:${organizationId}:${userId}`;
}
