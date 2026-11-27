import type { SeatRoleChangeStatus } from "@langwatch/organization-contract";
import type { RedisConnection } from "@langwatch/redis-client";

import { paymentKey, type SeatPaymentRef } from "../../rules/seat-role-change.rules.ts";
import type {
  PendingSeatRoleChangeRecord,
  PendingSeatRoleChangeRepository,
} from "../pending-seat-role-change.repository.ts";

const PREFIX = "organization:seat-role-change";
const KEEP_SECONDS = 7 * 24 * 60 * 60;
/** Renewed by its holder while the role write runs; a crashed applier frees the change after it. */
const CLAIM_SECONDS = 120;
/** Reserves the payment and writes the record and both indexes in one step, or writes nothing. */
const SAVE_SCRIPT =
  "if not redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3], 'NX') then return 0 end " +
  "redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3]) " +
  "redis.call('SET', KEYS[3], ARGV[1], 'EX', ARGV[3]) " +
  "redis.call('SET', KEYS[4], ARGV[1], 'EX', ARGV[3]) " +
  "return 1";
const RENEW_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end " +
  "return 0";
const RELEASE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
/** Replaces the record only while it still reads as the waiting one the caller saw. */
const SETTLE_SCRIPT =
  "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end " +
  "redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL') return 1";

type ChangeRef = { organizationId: string; id: string };

/**
 * The changes waiting on a seat payment, in process Redis with a week's expiry. Every key
 * carries the organization as its hash tag, so the save script stays in one Cluster slot.
 */
export class RedisPendingSeatRoleChangeRepository implements PendingSeatRoleChangeRepository {
  static create(redis: RedisConnection): RedisPendingSeatRoleChangeRepository {
    return new RedisPendingSeatRoleChangeRepository(redis);
  }

  private constructor(private readonly redis: RedisConnection) {}

  async save(record: PendingSeatRoleChangeRecord): Promise<boolean> {
    const saved = await this.redis.eval(
      SAVE_SCRIPT,
      4,
      paymentIndexKey({ organizationId: record.organizationId, payment: record.payment }),
      recordKey(record),
      memberKey(record),
      organizationKey(record),
      record.id,
      JSON.stringify(record),
      KEEP_SECONDS,
    );
    return saved === 1;
  }

  async findById(ref: ChangeRef): Promise<PendingSeatRoleChangeRecord[]> {
    const raw = await this.redis.get(recordKey(ref));
    return raw ? [JSON.parse(raw) as PendingSeatRoleChangeRecord] : [];
  }

  async findByPayment(input: {
    organizationId: string;
    payment: SeatPaymentRef;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const id = await this.redis.get(paymentIndexKey(input));
    return id ? this.findById({ organizationId: input.organizationId, id }) : [];
  }

  async findLatestForMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const id = await this.redis.get(memberKey(input));
    return id ? this.findById({ organizationId: input.organizationId, id }) : [];
  }

  async findWaitingForOrganization(input: {
    organizationId: string;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const id = await this.redis.get(organizationKey(input));
    const found = id ? await this.findById({ organizationId: input.organizationId, id }) : [];
    return found.filter((record) => record.status === "waiting");
  }

  async claim({ token, ...ref }: ChangeRef & { token: string }): Promise<boolean> {
    const taken = await this.redis.set(claimKey(ref), token, "EX", CLAIM_SECONDS, "NX");
    return taken === "OK";
  }

  async renew({ token, ...ref }: ChangeRef & { token: string }): Promise<boolean> {
    return (await this.redis.eval(RENEW_SCRIPT, 1, claimKey(ref), token, CLAIM_SECONDS)) === 1;
  }

  async release({ token, ...ref }: ChangeRef & { token: string }): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, claimKey(ref), token);
  }

  async settle({
    status,
    reason,
    ...ref
  }: ChangeRef & {
    status: Exclude<SeatRoleChangeStatus, "waiting">;
    reason?: string;
  }): Promise<boolean> {
    const raw = await this.redis.get(recordKey(ref));
    if (!raw) return false;
    const record = JSON.parse(raw) as PendingSeatRoleChangeRecord;
    if (record.status !== "waiting") return false;
    const settled = JSON.stringify({ ...record, status, reason: reason ?? null });
    return (await this.redis.eval(SETTLE_SCRIPT, 1, recordKey(ref), raw, settled)) === 1;
  }
}

/** The key prefix of one organization's changes; the braces are its Cluster hash tag. */
function scope(organizationId: string): string {
  return `${PREFIX}:{${organizationId}}`;
}

function recordKey({ organizationId, id }: ChangeRef): string {
  return `${scope(organizationId)}:${id}`;
}

function claimKey(ref: ChangeRef): string {
  return `${recordKey(ref)}:claim`;
}

function paymentIndexKey({
  organizationId,
  payment,
}: {
  organizationId: string;
  payment: SeatPaymentRef;
}): string {
  return `${scope(organizationId)}:payment:${paymentKey(payment)}`;
}

function organizationKey({ organizationId }: { organizationId: string }): string {
  return `${scope(organizationId)}:waiting`;
}

function memberKey({ organizationId, userId }: { organizationId: string; userId: string }): string {
  return `${scope(organizationId)}:member:${userId}`;
}
