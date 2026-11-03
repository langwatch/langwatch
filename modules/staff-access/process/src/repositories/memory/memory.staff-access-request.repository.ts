import { type Instant, Temporal } from "@langwatch/time";

import type {
  StaffAccessApproval,
  StaffAccessRedemption,
  StaffAccessRequestRepository,
  StaffAccessRequestRow,
} from "../staff-access.repository.ts";

function isAfter(moment: Instant, at: Instant): boolean {
  return Temporal.Instant.compare(moment, at) > 0;
}

function newestFirst(a: { createdAt: Instant }, b: { createdAt: Instant }): number {
  return Temporal.Instant.compare(b.createdAt, a.createdAt);
}

export class MemoryStaffAccessRequestRepository implements StaffAccessRequestRepository {
  readonly #rows = new Map<string, StaffAccessRequestRow>();

  static create(): MemoryStaffAccessRequestRepository {
    return new MemoryStaffAccessRequestRepository();
  }

  async create(row: StaffAccessRequestRow): Promise<void> {
    this.#rows.set(row.id, row);
  }

  async countSince({
    requesterId,
    since,
  }: {
    requesterId: string;
    since: Instant;
  }): Promise<number> {
    return this.#all().filter(
      (row) => row.requesterId === requesterId && !isAfter(since, row.createdAt),
    ).length;
  }

  async findById({ id }: { id: string }): Promise<StaffAccessRequestRow[]> {
    const row = this.#rows.get(id);
    return row ? [row] : [];
  }

  async findByApiKeyId({ apiKeyId }: { apiKeyId: string }): Promise<StaffAccessRequestRow[]> {
    return this.#all().filter((row) => row.apiKeyId === apiKeyId);
  }

  async findByOpsTokenLookupId({
    lookupId,
  }: {
    lookupId: string;
  }): Promise<StaffAccessRequestRow[]> {
    return this.#all().filter((row) => row.opsTokenLookupId === lookupId);
  }

  async findRecent({
    since,
    limit,
  }: {
    since: Instant;
    limit: number;
  }): Promise<StaffAccessRequestRow[]> {
    return this.#all()
      .filter((row) => !isAfter(since, row.createdAt))
      .toSorted(newestFirst)
      .slice(0, limit);
  }

  async findLive({ at }: { at: Instant }): Promise<StaffAccessRequestRow[]> {
    return this.#all().filter(
      (row) =>
        row.revokedAt === null &&
        (((row.status === "pending" || row.status === "approved") && isAfter(row.expiresAt, at)) ||
          (row.status === "redeemed" &&
            row.accessExpiresAt !== null &&
            isAfter(row.accessExpiresAt, at))),
    );
  }

  async findEndedUnaudited({
    at,
    limit,
  }: {
    at: Instant;
    limit: number;
  }): Promise<StaffAccessRequestRow[]> {
    return this.#all()
      .filter(
        (row) =>
          row.status === "redeemed" &&
          row.revokedAt === null &&
          row.endAuditedAt === null &&
          row.accessExpiresAt !== null &&
          !isAfter(row.accessExpiresAt, at),
      )
      .slice(0, limit);
  }

  async approve(input: StaffAccessApproval): Promise<boolean> {
    const row = this.#rows.get(input.id);
    if (!row || row.status !== "pending" || !isAfter(row.expiresAt, input.at)) return false;
    this.#rows.set(input.id, {
      ...row,
      status: "approved",
      approvedAt: input.at,
      spendApproved: input.spendApproved,
      approvalCredentialId: input.credentialId,
      approvalSignature: input.signature,
      signedHash: input.signedHash,
    });
    return true;
  }

  async deny({ id, at }: { id: string; at: Instant }): Promise<boolean> {
    const row = this.#rows.get(id);
    if (!row || row.status !== "pending" || !isAfter(row.expiresAt, at)) return false;
    this.#rows.set(id, { ...row, status: "denied" });
    return true;
  }

  async redeem(input: StaffAccessRedemption): Promise<boolean> {
    const row = this.#rows.get(input.id);
    if (!row || row.requesterId !== input.requesterId || row.status !== "approved") return false;
    const unspent = row.redeemedAt === null && row.revokedAt === null;
    if (!unspent || !isAfter(row.expiresAt, input.at)) return false;
    this.#rows.set(input.id, {
      ...row,
      status: "redeemed",
      redeemedAt: input.at,
      pinnedIp: input.pinnedIp,
      accessExpiresAt: input.accessExpiresAt,
    });
    return true;
  }

  async attachCredentials(input: {
    id: string;
    apiKeyId: string | null;
    hashedOpsToken: string | null;
    opsTokenLookupId: string | null;
  }): Promise<void> {
    const row = this.#rows.get(input.id);
    if (!row) return;
    this.#rows.set(input.id, {
      ...row,
      apiKeyId: input.apiKeyId,
      hashedOpsToken: input.hashedOpsToken,
      opsTokenLookupId: input.opsTokenLookupId,
    });
  }

  async revoke({
    id,
    at,
    byUserId,
    cause,
  }: {
    id: string;
    at: Instant;
    byUserId: string | null;
    cause: string;
  }): Promise<boolean> {
    const row = this.#rows.get(id);
    if (!row || !["pending", "approved", "redeemed"].includes(row.status)) return false;
    if (row.revokedAt !== null || row.endAuditedAt !== null) return false;
    if (row.accessExpiresAt !== null && !isAfter(row.accessExpiresAt, at)) return false;
    this.#rows.set(id, {
      ...row,
      status: "revoked",
      revokedAt: at,
      revokedByUserId: byUserId,
      revokeCause: cause,
      endAuditedAt: at,
    });
    return true;
  }

  async claimEndAudit({ id, at }: { id: string; at: Instant }): Promise<boolean> {
    const row = this.#rows.get(id);
    if (!row || row.endAuditedAt !== null || row.revokedAt !== null) return false;
    this.#rows.set(id, { ...row, endAuditedAt: at });
    return true;
  }

  async releaseEndAudit({ id }: { id: string }): Promise<void> {
    const row = this.#rows.get(id);
    if (row) this.#rows.set(id, { ...row, endAuditedAt: null });
  }

  #all(): StaffAccessRequestRow[] {
    return [...this.#rows.values()];
  }
}
