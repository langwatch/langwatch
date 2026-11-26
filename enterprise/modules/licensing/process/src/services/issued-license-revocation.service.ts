import {
  IssuedLicenseNotFoundError,
  LicenseInUseError,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

import type {
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import { refuseIfSettled } from "../rules/issued-license.rules.ts";
import type { ConnectManagedKeys } from "./license-registry.service.ts";

/** A key attaches at most once (attachVirtualKey requires none), so two passes suffice. */
const MAX_REVOKE_PASSES = 3;

type IssuedLicenseRevocationOptions = {
  repository: IssuedLicenseRepository;
  managedKeys: ConnectManagedKeys;
  now: () => Instant;
};

/** Revokes registry rows, ending the managed gateway key each one resolves to first. */
export class IssuedLicenseRevocationService {
  static create(options: IssuedLicenseRevocationOptions): IssuedLicenseRevocationService {
    return new IssuedLicenseRevocationService(options);
  }

  private constructor(private readonly options: IssuedLicenseRevocationOptions) {}

  /** Revokes `row` and answers the row as it now reads. */
  async revoke(input: {
    row: IssuedLicenseRecord;
    operatorId: string;
    reason: string;
    unusedOnly?: boolean;
  }): Promise<IssuedLicenseRecord> {
    if (input.unusedOnly) return this.revokeUnused(input);
    // An expired license can still be revoked: its term may be extended by a
    // reissue, and a leaked key should stay dead through that.
    this.refuseIfSettled(input.row);
    return this.revokeEndingEveryKey(input);
  }

  /**
   * The key ends first, then the row is marked only while it still names that key. A key
   * that attached in between refuses the mark and is ended on the next pass, so every key
   * ends before the row is revoked and a failure leaves a live license to revoke again.
   */
  private async revokeEndingEveryKey({
    row,
    operatorId,
    reason,
  }: {
    row: IssuedLicenseRecord;
    operatorId: string;
    reason: string;
  }): Promise<IssuedLicenseRecord> {
    let current = row;
    for (let pass = 0; pass < MAX_REVOKE_PASSES; pass++) {
      await this.retireManagedKey({ row: current, actorId: operatorId });
      const marked = await this.options.repository.revokeHolding({
        id: current.id,
        virtualKeyId: current.virtualKeyId,
        at: this.options.now(),
        revokedById: operatorId,
        revokedReason: reason,
      });
      current = await this.getRow(row.id);
      if (marked) return current;
      this.refuseIfSettled(current);
    }
    throw new Error("The license's managed key kept changing while it was revoked");
  }

  /**
   * Revokes a key no install used. The key ends first, so a failure leaves the license live
   * to revoke again. The row is then marked in one conditional write a racing bind cannot
   * also win; if the bind won, the row lets go of the ended key for a fresh one next sync.
   */
  private async revokeUnused({
    row,
    operatorId,
    reason,
  }: {
    row: IssuedLicenseRecord;
    operatorId: string;
    reason: string;
  }): Promise<IssuedLicenseRecord> {
    this.refuseIfSettled(row);
    if (row.instanceId !== null) throw new LicenseInUseError();
    await this.retireManagedKey({ row, actorId: operatorId });
    const revoked = await this.options.repository.revokeUnbound({
      id: row.id,
      at: this.options.now(),
      revokedById: operatorId,
      revokedReason: reason,
    });
    if (!revoked) await this.refuseLostRevoke(row);
    return this.getRow(row.id);
  }

  /** An unused-key revoke lost its write to a bind or another settle: say which. */
  private async refuseLostRevoke(row: IssuedLicenseRecord): Promise<never> {
    if (row.virtualKeyId) {
      await this.options.repository.releaseVirtualKey({ virtualKeyId: row.virtualKeyId });
    }
    this.refuseIfSettled(await this.getRow(row.id));
    throw new LicenseInUseError();
  }

  /** Ends the managed key the row resolves to, if it has one. Safe to repeat. */
  async retireManagedKey({
    row,
    actorId,
  }: {
    row: IssuedLicenseRecord;
    actorId: string;
  }): Promise<void> {
    if (!row.virtualKeyId || !row.organizationId) return;
    await this.options.managedKeys.retire({
      virtualKeyId: row.virtualKeyId,
      organizationId: row.organizationId,
      actorId,
    });
  }

  private refuseIfSettled(row: IssuedLicenseRecord): void {
    refuseIfSettled({ row, now: this.options.now() });
  }

  private async getRow(id: string): Promise<IssuedLicenseRecord> {
    const row = await this.options.repository.findById(id);
    if (!row) throw new IssuedLicenseNotFoundError();
    return row;
  }
}
