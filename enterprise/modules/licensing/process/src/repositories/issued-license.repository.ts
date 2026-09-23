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
  maxMembersLite: number;
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
  createdAt: Instant;
  updatedAt: Instant;
}

export type IssuedLicenseDraft = Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">;

export type IssuedLicensePatch = Partial<IssuedLicenseDraft>;

export interface IssuedLicenseRepository {
  create(data: IssuedLicenseDraft): Promise<IssuedLicenseRecord>;
  findById(id: string): Promise<IssuedLicenseRecord | null>;
  findByTokenHash(tokenHash: string): Promise<IssuedLicenseRecord | null>;
  findByVirtualKeyId(virtualKeyId: string): Promise<IssuedLicenseRecord | null>;
  /** The license that replaced this one, when it was reissued. */
  findByReplacesId(replacesId: string): Promise<IssuedLicenseRecord | null>;
  /** Every license of a customer, whatever its state. */
  findAllByOrganization(organizationId: string): Promise<IssuedLicenseRecord[]>;
  /** Unrevoked licenses bound to one install, the most recently bound first. */
  findAllBoundToInstance(instanceId: string): Promise<IssuedLicenseRecord[]>;
  findAll(params: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: IssuedLicenseRecord[]; total: number }>;
  update(id: string, data: IssuedLicensePatch): Promise<IssuedLicenseRecord>;
  /**
   * Binds the license to an install only while it has none, and answers whether
   * this call was the one that bound it.
   */
  bindInstance(params: { id: string; instanceId: string; at: Instant }): Promise<boolean>;
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
