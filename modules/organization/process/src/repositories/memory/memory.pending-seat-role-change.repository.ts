import type { SeatRoleChangeStatus } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import { paymentKey, type SeatPaymentRef } from "../../rules/seat-role-change.rules.ts";
import type {
  PendingSeatRoleChangeRecord,
  PendingSeatRoleChangeRepository,
} from "../pending-seat-role-change.repository.ts";

/** The week Redis keeps a change for, from the moment it was saved. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** The claim period Redis gives an applier before another may take the change. */
const CLAIM_MS = 120 * 1000;

type ChangeRef = { organizationId: string; id: string };
type Kept = { record: PendingSeatRoleChangeRecord; expiresAt: number };
type Claim = { token: string; expiresAt: number };

/** The changes waiting on a seat payment, held in the process; each expires a week after saving. */
export class MemoryPendingSeatRoleChangeRepository implements PendingSeatRoleChangeRepository {
  private readonly records = new Map<string, Kept>();
  /** The organization's latest saved change, as the Redis index keeps it. */
  private readonly latestForOrganization = new Map<string, string>();
  private readonly claims = new Map<string, Claim>();

  static create({
    now = () => nowInstant().epochMilliseconds,
  }: { now?: () => number } = {}): MemoryPendingSeatRoleChangeRepository {
    return new MemoryPendingSeatRoleChangeRepository(now);
  }

  private constructor(private readonly now: () => number) {}

  async save(record: PendingSeatRoleChangeRecord): Promise<boolean> {
    const key = paymentKey(record.payment);
    const taken = this.live().some(
      (kept) => kept.organizationId === record.organizationId && paymentKey(kept.payment) === key,
    );
    if (taken) return false;
    this.records.set(record.id, { record, expiresAt: this.now() + KEEP_MS });
    this.latestForOrganization.set(record.organizationId, record.id);
    return true;
  }

  async findById({ organizationId, id }: ChangeRef): Promise<PendingSeatRoleChangeRecord[]> {
    const record = this.read(id);
    return record?.organizationId === organizationId ? [record] : [];
  }

  async findByPayment({
    organizationId,
    payment,
  }: {
    organizationId: string;
    payment: SeatPaymentRef;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const key = paymentKey(payment);
    return this.live().filter(
      (record) => record.organizationId === organizationId && paymentKey(record.payment) === key,
    );
  }

  async findLatestForMember({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const latest = this.live()
      .filter((record) => record.organizationId === organizationId && record.userId === userId)
      .toSorted((a, b) => b.createdAt - a.createdAt)[0];
    return latest ? [latest] : [];
  }

  async findWaitingForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const id = this.latestForOrganization.get(organizationId);
    const record = id === undefined ? undefined : this.read(id);
    return record?.status === "waiting" ? [record] : [];
  }

  async claim({ id, token }: ChangeRef & { token: string }): Promise<boolean> {
    if (this.liveClaim(id)) return false;
    this.claims.set(id, { token, expiresAt: this.now() + CLAIM_MS });
    return true;
  }

  async renew({ id, token }: ChangeRef & { token: string }): Promise<boolean> {
    if (this.liveClaim(id)?.token !== token) return false;
    this.claims.set(id, { token, expiresAt: this.now() + CLAIM_MS });
    return true;
  }

  async release({ id, token }: ChangeRef & { token: string }): Promise<void> {
    if (this.liveClaim(id)?.token === token) this.claims.delete(id);
  }

  async settle({
    organizationId,
    id,
    status,
    reason,
  }: ChangeRef & {
    status: Exclude<SeatRoleChangeStatus, "waiting">;
    reason?: string;
  }): Promise<boolean> {
    const kept = this.records.get(id);
    const record = this.read(id);
    if (!kept || record?.organizationId !== organizationId || record.status !== "waiting") {
      return false;
    }
    this.records.set(id, { ...kept, record: { ...record, status, reason: reason ?? null } });
    return true;
  }

  private liveClaim(id: string): Claim | undefined {
    const claim = this.claims.get(id);
    return claim && claim.expiresAt > this.now() ? claim : undefined;
  }

  private read(id: string): PendingSeatRoleChangeRecord | undefined {
    const kept = this.records.get(id);
    return kept && kept.expiresAt > this.now() ? kept.record : undefined;
  }

  private live(): PendingSeatRoleChangeRecord[] {
    const now = this.now();
    return [...this.records.values()]
      .filter((kept) => kept.expiresAt > now)
      .map((kept) => kept.record);
  }
}
