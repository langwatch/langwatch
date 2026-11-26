/**
 * The license registry's own state (ADR-156). The stored row lives here because
 * it is the feature's own; what leaves the feature is the view. Two writes are
 * conditional, because two callers race on both and the table decides.
 */

import type { IssuedLicenseSource, SeatCurrency } from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

/** A registry row, as stored. */
export interface IssuedLicenseRecord {
  id: string;
  licenseId: string;
  tokenHash: string;
  organizationId: string | null;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  /** Null when the license states none, or when `liteSeatsUnlimited`. */
  maxMembersLite: number | null;
  liteSeatsUnlimited: boolean;
  /** Null when the license states none, which sells none. */
  maxMembersDeveloper: number | null;
  issuedAt: Instant;
  expiresAt: Instant;
  source: IssuedLicenseSource;
  issuedById: string | null;
  revokedAt: Instant | null;
  revokedById: string | null;
  revokedReason: string | null;
  supersededAt: Instant | null;
  replacesId: string | null;
  /** The one license text the registry holds, encrypted, until it is delivered. */
  pendingDeliveryLicense: string | null;
  services: string[];
  seatRateCents: number | null;
  seatCurrency: SeatCurrency | null;
  commitUsdCents: number;
  overageEnabled: boolean;
  overageMaxUsdCents: number | null;
  instanceId: string | null;
  instanceBoundAt: Instant | null;
  lastSyncAt: Instant | null;
  lastSyncVersion: string | null;
  reportedMembers: number | null;
  reportedMembersLite: number | null;
  virtualKeyId: string | null;
  /** The seats of the replaced license, set only when a seat change raised a linked one. */
  seatsRaisedFrom: number | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export type IssuedLicenseDraft = Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">;

export type IssuedLicensePatch = Partial<IssuedLicenseDraft>;

/** Which rows a list keeps. Every part is optional; absent keeps every row. */
export type IssuedLicenseQuery = {
  search?: string;
  /**
   * Keeps the rows active at `at` (not revoked, superseded or expired), or with
   * `active` false, the rest.
   */
  status?: { at: Instant; active: boolean };
  /**
   * Keeps the rows whose email ends with one of these, case aside, or with
   * `matching` false, the rest.
   */
  emailSuffixes?: { suffixes: readonly string[]; matching: boolean };
  /**
   * Keeps only the newest license of each reissue chain: drops every row an
   * unrevoked row replaces, so a chain lists and counts once.
   */
  chainHeadsOnly?: boolean;
};

export interface IssuedLicenseRepository {
  create(data: IssuedLicenseDraft): Promise<IssuedLicenseRecord>;
  findById(id: string): Promise<IssuedLicenseRecord | null>;
  findByTokenHash(tokenHash: string): Promise<IssuedLicenseRecord | null>;
  findByVirtualKeyId(virtualKeyId: string): Promise<IssuedLicenseRecord | null>;
  /** The license that replaced this one, when it was reissued. */
  findByReplacesId(replacesId: string): Promise<IssuedLicenseRecord | null>;
  /** Every license of a customer, whatever its state. */
  findAllByOrganization(organizationId: string): Promise<IssuedLicenseRecord[]>;
  /** Every license a seat change raised, oldest first; one customer's when named. */
  findAllSeatsRaised(params: { organizationId?: string }): Promise<IssuedLicenseRecord[]>;
  /** Unrevoked licenses bound to one install, the most recently bound first. */
  findAllBoundToInstance(instanceId: string): Promise<IssuedLicenseRecord[]>;
  /** One page of the rows the query keeps, the newest first, and how many it keeps in all. */
  listAll(
    params: IssuedLicenseQuery & { page: number; pageSize: number },
  ): Promise<{ rows: IssuedLicenseRecord[]; total: number }>;
  /** How many rows the query keeps. */
  countAll(query: IssuedLicenseQuery): Promise<number>;
  update(id: string, data: IssuedLicensePatch): Promise<IssuedLicenseRecord>;
  /** Removes a row a failed flow wrote; a row already gone is not an error. */
  delete(id: string): Promise<void>;
  /**
   * Binds the license to an install only while it has none and is not revoked,
   * and answers whether this call was the one that bound it.
   */
  bindInstance(params: { id: string; instanceId: string; at: Instant }): Promise<boolean>;
  /**
   * Revokes the license only while no install is bound and it is not revoked,
   * in the same statement as the check, so a bind and this revoke cannot both
   * win. Answers whether this call revoked it.
   */
  revokeUnbound(params: {
    id: string;
    at: Instant;
    revokedById: string;
    revokedReason: string;
  }): Promise<boolean>;
  /**
   * Revokes the license only while it still names `virtualKeyId` (none included) and is not
   * revoked, so a key that attached after the caller ended the old one refuses the mark.
   */
  revokeHolding(params: {
    id: string;
    virtualKeyId: string | null;
    at: Instant;
    revokedById: string;
    revokedReason: string;
  }): Promise<boolean>;
  /**
   * Lets go of an ended managed key on the live license that still names it, so its
   * install's next sync provisions a new one. A revoked license keeps the key it names.
   */
  releaseVirtualKey(params: { virtualKeyId: string }): Promise<boolean>;
  /**
   * Records the managed key only while the license has none and still is the
   * active license of that customer on that install. `requires` is checked in
   * the same statement as the write.
   */
  attachVirtualKey(params: {
    id: string;
    virtualKeyId: string;
    requires: { organizationId: string; instanceId: string; activeAt: Instant };
  }): Promise<boolean>;
}
