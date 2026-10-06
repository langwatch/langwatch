import { generate } from "@langwatch/ksuid";
import { nowInstant, Temporal } from "@langwatch/time";

import {
  type LangyTurnAdmissionClaim,
  LangyTurnAdmissionRepository,
} from "../langy-turn-admission.repository.ts";
import type {
  LangyMemoryActiveTurn,
  LangyMemoryStore,
  LangyMemoryTurnRequest,
} from "./langy-memory.store.ts";

const PREPARING = "preparing";
const COMMITTED = "committed";
const PREPARATION_LEASE_MS = 2 * 60 * 1000;
const COMMITTED_LEASE = Temporal.Instant.from("9999-12-31T23:59:59.999Z").epochMilliseconds;
const COMMITTED_ABANDON_MS = 10 * 60 * 1000;

type ClaimInput = {
  projectId: string;
  userId: string;
  idempotencyKey: string;
  conversationId: string;
  turnId: string;
};
type HeldClaim = ClaimInput & { claimToken: string };

/**
 * The memory twin of `PrismaLangyTurnAdmissionRepository`: the same receipt
 * and one-active-turn rules, each step synchronous, so the single thread
 * stands in for the serializable transaction.
 */
export class MemoryLangyTurnAdmissionRepository extends LangyTurnAdmissionRepository {
  static create(store: LangyMemoryStore): MemoryLangyTurnAdmissionRepository {
    return new MemoryLangyTurnAdmissionRepository(store);
  }

  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  async claim(input: ClaimInput): Promise<LangyTurnAdmissionClaim> {
    const now = nowInstant().epochMilliseconds;
    const claimToken = generate("langy").toString();
    const leaseExpiresAt = now + PREPARATION_LEASE_MS;
    const receiptKey = this.receiptKey(input);
    const existing = this.store.turnRequests.get(receiptKey);
    let receipt: LangyMemoryTurnRequest;
    if (!existing) {
      receipt = {
        projectId: input.projectId,
        userId: input.userId,
        requestId: input.idempotencyKey,
        conversationId: input.conversationId,
        turnId: input.turnId,
        status: PREPARING,
        leaseOwner: claimToken,
        leaseExpiresAt,
      };
      this.store.turnRequests.set(receiptKey, receipt);
    } else {
      if (existing.turnId !== input.turnId) return { kind: "mismatch" };
      if (existing.status === COMMITTED) {
        return { kind: "replay", conversationId: existing.conversationId, turnId: existing.turnId };
      }
      if (existing.leaseExpiresAt > now) return { kind: "pending" };
      existing.leaseOwner = claimToken;
      existing.leaseExpiresAt = leaseExpiresAt;
      receipt = existing;
    }
    const { conversationId, turnId } = receipt;
    const held = {
      requestId: input.idempotencyKey,
      userId: input.userId,
      status: PREPARING,
      leaseOwner: claimToken,
      leaseExpiresAt,
      updatedAt: now,
    };
    const activeKey = `${input.projectId}:${conversationId}`;
    const active = this.store.activeTurns.get(activeKey);
    if (!active || active.turnId === turnId || isAbandoned(active, now)) {
      this.store.activeTurns.set(activeKey, {
        projectId: input.projectId,
        conversationId,
        turnId,
        ...held,
      });
      return { kind: "claimed", claimToken, conversationId, turnId };
    }
    if (receipt.status === PREPARING && receipt.leaseOwner === claimToken) {
      this.store.turnRequests.delete(receiptKey);
    }
    return { kind: "busy" };
  }

  async commit(input: HeldClaim): Promise<void> {
    const receipt = this.store.turnRequests.get(this.receiptKey(input));
    if (receipt && matchesClaim(receipt, input)) {
      receipt.status = COMMITTED;
      receipt.leaseExpiresAt = COMMITTED_LEASE;
    } else if (
      receipt?.conversationId !== input.conversationId ||
      receipt.turnId !== input.turnId ||
      receipt.status !== COMMITTED
    ) {
      throw new Error(`Langy turn admission receipt commit lost its claim for ${input.turnId}`);
    }
    const active = this.store.activeTurns.get(`${input.projectId}:${input.conversationId}`);
    if (active && matchesClaim(active, input)) {
      active.status = COMMITTED;
      active.leaseExpiresAt = COMMITTED_LEASE;
      active.updatedAt = nowInstant().epochMilliseconds;
      return;
    }
    // A matching terminal event may already have released this row; another turn's row never is.
    if (active && (active.turnId !== input.turnId || active.status !== COMMITTED)) {
      throw new Error(`Langy active-turn commit lost its claim for ${input.turnId}`);
    }
  }

  async confirmAccepted(input: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    const active = this.store.activeTurns.get(`${input.projectId}:${input.conversationId}`);
    // A stale event for an older turn must never promote the conversation's newer claim.
    if (!active || active.turnId !== input.turnId) return;
    const receipt = this.store.turnRequests.get(
      this.receiptKey({
        projectId: input.projectId,
        userId: active.userId,
        idempotencyKey: active.requestId,
      }),
    );
    if (
      receipt?.conversationId === input.conversationId &&
      receipt.turnId === input.turnId &&
      receipt.status === PREPARING
    ) {
      receipt.status = COMMITTED;
      receipt.leaseExpiresAt = COMMITTED_LEASE;
    }
    active.status = COMMITTED;
    active.leaseExpiresAt = COMMITTED_LEASE;
    active.updatedAt = nowInstant().epochMilliseconds;
  }

  async abort(input: HeldClaim): Promise<void> {
    const activeKey = `${input.projectId}:${input.conversationId}`;
    const active = this.store.activeTurns.get(activeKey);
    if (active && matchesClaim(active, input)) this.store.activeTurns.delete(activeKey);
    const receiptKey = this.receiptKey(input);
    const receipt = this.store.turnRequests.get(receiptKey);
    if (receipt && matchesClaim(receipt, input)) this.store.turnRequests.delete(receiptKey);
  }

  async release(input: {
    projectId: string;
    conversationId: string;
    turnId?: string;
  }): Promise<void> {
    const key = `${input.projectId}:${input.conversationId}`;
    const active = this.store.activeTurns.get(key);
    if (active && (!input.turnId || active.turnId === input.turnId)) {
      this.store.activeTurns.delete(key);
    }
  }

  private receiptKey(input: { projectId: string; userId: string; idempotencyKey: string }): string {
    return `${input.projectId}:${input.userId}:${input.idempotencyKey}`;
  }
}

/** A turn another send holds may be taken once its preparation lapsed or its commit went quiet. */
function isAbandoned(active: LangyMemoryActiveTurn, now: number): boolean {
  if (active.status === PREPARING) return active.leaseExpiresAt <= now;
  if (active.status !== COMMITTED) return false;
  return now - active.updatedAt > COMMITTED_ABANDON_MS;
}

/** The row is still the preparing one this claim leased for this exact turn. */
function matchesClaim(
  row: { conversationId: string; turnId: string; status: string; leaseOwner: string },
  claim: HeldClaim,
): boolean {
  return (
    row.conversationId === claim.conversationId &&
    row.turnId === claim.turnId &&
    row.status === PREPARING &&
    row.leaseOwner === claim.claimToken
  );
}
