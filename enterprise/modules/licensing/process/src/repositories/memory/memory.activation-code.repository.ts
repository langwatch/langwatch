import { Temporal, type Instant } from "@langwatch/time";

import type {
  ActivationClaim,
  ActivationCodeDraft,
  ActivationCodeRecord,
  ActivationCodeRepository,
} from "../activation-code.repository.ts";

/**
 * Activation codes in memory. The two conditional writes are the twin's whole
 * point: each answers false exactly where the statement's WHERE clause would
 * match no row, so a test can prove two installs racing without a database.
 */
export class MemoryActivationCodeRepository implements ActivationCodeRepository {
  static create(
    rows: readonly (ActivationCodeRecord & { codeHash: string })[] = [],
  ): MemoryActivationCodeRepository {
    return new MemoryActivationCodeRepository(new Map(rows.map((row) => [row.id, { ...row }])));
  }

  #sequence = 0;

  private constructor(
    private readonly rows: Map<string, ActivationCodeRecord & { codeHash: string }>,
  ) {
    this.#sequence = rows.size;
  }

  async create(input: ActivationCodeDraft): Promise<ActivationCodeRecord> {
    this.#sequence += 1;
    const row: ActivationCodeRecord & { codeHash: string } = {
      ...input,
      maxMembersLite: input.maxMembersLite ?? 0,
      services: [...input.services],
      id: `activation-code-${this.#sequence}`,
      redeemedAt: null,
      redeemedByInstanceId: null,
      issuedLicenseId: null,
      redemptionCount: 0,
      revokedAt: null,
      createdAt: input.expiresAt,
    };
    this.rows.set(row.id, row);
    return view(row);
  }

  async findByCodeHash(codeHash: string): Promise<ActivationCodeRecord | null> {
    const row = [...this.rows.values()].find((candidate) => candidate.codeHash === codeHash);
    return row ? view(row) : null;
  }

  async findById(id: string): Promise<ActivationCodeRecord | null> {
    const row = this.rows.get(id);
    return row ? view(row) : null;
  }

  async findAll({
    page,
    pageSize,
    organizationId,
  }: {
    page: number;
    pageSize: number;
    organizationId?: string;
  }): Promise<{ rows: ActivationCodeRecord[]; total: number }> {
    const matching = [...this.rows.values()].filter(
      (row) => organizationId === undefined || row.organizationId === organizationId,
    );
    return {
      rows: matching.slice(page * pageSize, page * pageSize + pageSize).map(view),
      total: matching.length,
    };
  }

  async claimSingleUse({ id, instanceId, at }: ActivationClaim): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.redeemedAt || row.revokedAt) return false;
    if (Temporal.Instant.compare(row.expiresAt, at) <= 0) return false;
    this.#redeem(row, instanceId, at);
    return true;
  }

  async recordReusableRedemption({ id, instanceId, at }: ActivationClaim): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row?.reusable || row.revokedAt) return false;
    if (Temporal.Instant.compare(row.expiresAt, at) <= 0) return false;
    this.#redeem(row, instanceId, at);
    return true;
  }

  async attachIssuedLicense({
    id,
    issuedLicenseId,
  }: {
    id: string;
    issuedLicenseId: string;
  }): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.issuedLicenseId = issuedLicenseId;
  }

  async releaseClaim({ id, instanceId }: { id: string; instanceId: string }): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.redeemedByInstanceId !== instanceId) return;
    row.redeemedAt = null;
    row.redeemedByInstanceId = null;
    row.redemptionCount = Math.max(row.redemptionCount - 1, 0);
  }

  async revoke(input: { id: string; at: Instant; revokedById: string }): Promise<boolean> {
    const row = this.rows.get(input.id);
    if (!row || row.revokedAt) return false;
    row.revokedAt = input.at;
    return true;
  }

  #redeem(row: ActivationCodeRecord & { codeHash: string }, instanceId: string, at: Instant): void {
    row.redeemedAt = at;
    row.redeemedByInstanceId = instanceId;
    row.redemptionCount += 1;
  }
}

function view({
  codeHash: _codeHash,
  ...record
}: ActivationCodeRecord & { codeHash: string }): ActivationCodeRecord {
  return { ...record, services: [...record.services] };
}
