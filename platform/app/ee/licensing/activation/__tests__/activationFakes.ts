/**
 * A registry of activation codes held in memory, with the one property that
 * matters: the claim is atomic.
 *
 * `claimSingleUse` reads and writes `redeemedAt` without awaiting anything in
 * between, so it behaves the way the conditional UPDATE behaves, and two
 * redemptions interleaved at any await point still produce one winner. A fake
 * that awaited inside the claim would pass the concurrency test for the wrong
 * reason.
 */

import type {
  ActivationCodeRecord,
  ActivationCodeRepository,
} from "../activationCodes";

export const CODE = "LW-A1B2-C3D4-E5F6-G7H8";

export function codeRecord(
  overrides: Partial<ActivationCodeRecord> = {},
): ActivationCodeRecord {
  return {
    id: "code-1",
    codeHint: "G7H8",
    organizationId: "org-acme",
    organizationName: "ACME",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 25,
    maxMembersLite: 0,
    licenseTermDays: 365,
    services: ["instant_evals"],
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    reusable: false,
    redeemedAt: null,
    redeemedByInstanceId: null,
    issuedLicenseId: null,
    redemptionCount: 0,
    revokedAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

export class InMemoryActivationCodes implements ActivationCodeRepository {
  readonly rows = new Map<string, ActivationCodeRecord>();
  /** Set on the row whose claim won, for the tests that count winners. */
  claimsWon = 0;

  constructor(
    rows: ActivationCodeRecord[],
    private readonly hashOf: (record: ActivationCodeRecord) => string,
  ) {
    for (const row of rows) this.rows.set(row.id, row);
  }

  async create(): Promise<ActivationCodeRecord> {
    throw new Error("the fake registry does not issue codes");
  }

  async findByCodeHash(codeHash: string): Promise<ActivationCodeRecord | null> {
    for (const row of this.rows.values()) {
      if (this.hashOf(row) === codeHash) return { ...row };
    }
    return null;
  }

  async findById(id: string): Promise<ActivationCodeRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async findAll(): Promise<{ rows: ActivationCodeRecord[]; total: number }> {
    const rows = [...this.rows.values()];
    return { rows, total: rows.length };
  }

  // Deliberately synchronous inside: this is the conditional UPDATE, and it
  // decides the winner in one step with no await for another redemption to
  // slip into.
  async claimSingleUse({
    id,
    instanceId,
    at,
  }: {
    id: string;
    instanceId: string;
    at: Date;
  }): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    if (row.reusable || row.redeemedAt || row.revokedAt) return false;
    if (row.expiresAt.getTime() <= at.getTime()) return false;
    this.rows.set(id, {
      ...row,
      redeemedAt: at,
      redeemedByInstanceId: instanceId,
      redemptionCount: row.redemptionCount + 1,
    });
    this.claimsWon += 1;
    return true;
  }

  async recordReusableRedemption({
    id,
    instanceId,
    at,
  }: {
    id: string;
    instanceId: string;
    at: Date;
  }): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row?.reusable || row.revokedAt) return false;
    if (row.expiresAt.getTime() <= at.getTime()) return false;
    this.rows.set(id, {
      ...row,
      redeemedAt: at,
      redeemedByInstanceId: instanceId,
      redemptionCount: row.redemptionCount + 1,
    });
    this.claimsWon += 1;
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
    if (row) this.rows.set(id, { ...row, issuedLicenseId });
  }

  async releaseClaim({
    id,
    instanceId,
  }: {
    id: string;
    instanceId: string;
  }): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.redeemedByInstanceId !== instanceId) return;
    this.rows.set(id, {
      ...row,
      redeemedAt: null,
      redeemedByInstanceId: null,
      redemptionCount: Math.max(0, row.redemptionCount - 1),
    });
  }

  async revoke({
    id,
    at,
  }: {
    id: string;
    at: Date;
    revokedById: string;
  }): Promise<ActivationCodeRecord | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (!row.revokedAt) this.rows.set(id, { ...row, revokedAt: at });
    return this.findById(id);
  }
}
