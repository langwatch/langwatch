import type { SeatRoleChangeStatus } from "@langwatch/organization-contract";

import { paymentKey, type SeatPaymentRef } from "../../rules/seat-role-change.rules.ts";
import type {
  PendingSeatRoleChangeRecord,
  PendingSeatRoleChangeRepository,
} from "../pending-seat-role-change.repository.ts";

/** The changes waiting on a seat payment, held in the process; nothing expires. */
export class MemoryPendingSeatRoleChangeRepository implements PendingSeatRoleChangeRepository {
  private readonly records = new Map<string, PendingSeatRoleChangeRecord>();
  private readonly claims = new Map<string, string>();

  static create(): MemoryPendingSeatRoleChangeRepository {
    return new MemoryPendingSeatRoleChangeRepository();
  }

  private constructor() {}

  async save(record: PendingSeatRoleChangeRecord): Promise<boolean> {
    const key = paymentKey(record.payment);
    const saved = [...this.records.values()].map((kept) => paymentKey(kept.payment));
    if (saved.includes(key)) return false;
    this.records.set(record.id, record);
    return true;
  }

  async findById({ id }: { id: string }): Promise<PendingSeatRoleChangeRecord[]> {
    const record = this.records.get(id);
    return record ? [record] : [];
  }

  async findByPayment({
    payment,
  }: {
    payment: SeatPaymentRef;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const key = paymentKey(payment);
    return [...this.records.values()].filter((record) => paymentKey(record.payment) === key);
  }

  async findLatestForMember({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    const latest = [...this.records.values()]
      .filter((record) => record.organizationId === organizationId && record.userId === userId)
      .toSorted((a, b) => b.createdAt - a.createdAt)[0];
    return latest ? [latest] : [];
  }

  async findWaitingForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PendingSeatRoleChangeRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.organizationId === organizationId && record.status === "waiting",
    );
  }

  async claim({ id, token }: { id: string; token: string }): Promise<boolean> {
    if (this.claims.has(id)) return false;
    this.claims.set(id, token);
    return true;
  }

  async holds({ id, token }: { id: string; token: string }): Promise<boolean> {
    return this.claims.get(id) === token;
  }

  async release({ id, token }: { id: string; token: string }): Promise<void> {
    if (this.claims.get(id) === token) this.claims.delete(id);
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
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, status, reason: reason ?? null });
  }
}
