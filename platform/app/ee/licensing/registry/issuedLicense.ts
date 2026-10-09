/**
 * The registry row and the vocabulary around it (ADR-141): what a license looks
 * like as stored, how the backoffice reads it, the ports the service writes
 * through, and the two rules that are derived from the row alone.
 *
 * The service that uses all of this is `./licenseRegistry.service.ts`.
 */

import type { ConnectService } from "../connect/services";

export type IssuedLicenseSource =
  | "BACKOFFICE"
  | "PURCHASE"
  | "SCRIPT"
  | "LEGACY_IMPORT";

export type SeatCurrency = "USD" | "EUR";

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
  issuedAt: Date;
  expiresAt: Date;
  source: IssuedLicenseSource;
  issuedById: string | null;
  revokedAt: Date | null;
  revokedById: string | null;
  revokedReason: string | null;
  supersededAt: Date | null;
  replacesId: string | null;
  pendingDeliveryLicense: string | null;
  services: string[];
  seatRateCents: number | null;
  seatCurrency: SeatCurrency | null;
  commitUsdCents: number;
  overageEnabled: boolean;
  overageMaxUsdCents: number | null;
  instanceId: string | null;
  instanceBoundAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncVersion: string | null;
  reportedMembers: number | null;
  reportedMembersLite: number | null;
  virtualKeyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IssuedLicenseStatus =
  | "active"
  | "revoked"
  | "superseded"
  | "expired";

/**
 * A registry row as the backoffice reads it: the stored row without the held
 * license, plus what is derived from it.
 */
export type IssuedLicenseView = Omit<
  IssuedLicenseRecord,
  "pendingDeliveryLicense"
> & {
  status: IssuedLicenseStatus;
  /** Whether a reissued license is waiting to be delivered to its install. */
  hasPendingDelivery: boolean;
};

export interface IssuedLicenseRepository {
  create(
    data: Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<IssuedLicenseRecord>;
  findById(id: string): Promise<IssuedLicenseRecord | null>;
  findByTokenHash(tokenHash: string): Promise<IssuedLicenseRecord | null>;
  findByVirtualKeyId(virtualKeyId: string): Promise<IssuedLicenseRecord | null>;
  /** Every license of a customer, whatever its state. */
  findAllByOrganization(organizationId: string): Promise<IssuedLicenseRecord[]>;
  findAll(params: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: IssuedLicenseRecord[]; total: number }>;
  update(
    id: string,
    data: Partial<Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<IssuedLicenseRecord>;
  /**
   * Binds the license to an install only while it has none. Answers whether
   * this call was the one that bound it, so two installs racing leave one bound.
   */
  bindInstance(params: {
    id: string;
    instanceId: string;
    at: Date;
  }): Promise<boolean>;
  /**
   * Records the managed key only while the license has none and still is the
   * active license of that customer on that install. Answers whether this call
   * was the one that recorded it.
   *
   * The `requires` clause is what a revocation races against: it is checked in
   * the same statement as the write, so a license revoked after the caller read
   * the row cannot be handed a fresh, active key.
   */
  attachVirtualKey(params: {
    id: string;
    virtualKeyId: string;
    requires: { organizationId: string; instanceId: string; activeAt: Date };
  }): Promise<boolean>;
  /** The license that replaced this one, when it was reissued. */
  findByReplacesId(replacesId: string): Promise<IssuedLicenseRecord | null>;
}

/**
 * The managed gateway key a license resolves to. Ending or invalidating it is
 * what reaches a gateway that already cached the credential: both write to the
 * change feed every gateway polls.
 */
export interface ConnectManagedKeyPort {
  provision(params: {
    organizationId: string;
    licenseId: string;
  }): Promise<{ id: string }>;
  /** Ends the key for good. Safe to repeat. */
  retire(params: {
    virtualKeyId: string;
    organizationId: string;
    actorId: string;
  }): Promise<void>;
  /** Makes every gateway resolve the license again on its next call. */
  invalidate(params: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<void>;
}

export interface CustomerOrganizationPort {
  findById(id: string): Promise<{ id: string; name: string } | null>;
  createSelfHostedCustomer(params: {
    name: string;
  }): Promise<{ id: string; name: string }>;
  markSelfHostedCustomer(id: string): Promise<void>;
}

/**
 * The customer's contract budget, which follows the commercial terms of its
 * licenses. Called after any change that can move those terms.
 */
export interface ContractBudgetSyncPort {
  sync(params: { organizationId: string; operatorId: string }): Promise<void>;
}

/**
 * What a mid-term seat change owes: seats added on a license are invoiced
 * prorated to the end of the term, by the connected billing service. The
 * registry only names the change; billing decides the amount and keeps the
 * invoice from being raised twice.
 */
export type SeatChangeBillingOutcome =
  | "invoiced"
  | "nothing_to_invoice"
  | "not_onboarded";

export interface SeatChangeBillingPort {
  invoiceAddedSeats(params: {
    organizationId: string;
    /** The reissued `IssuedLicense` row the new seat count is signed into. */
    licenseRowId: string;
    previousSeats: number;
    seats: number;
    operatorId: string;
  }): Promise<SeatChangeBillingOutcome>;
}

export interface LicenseRegistryDependencies {
  repository: IssuedLicenseRepository;
  organizations: CustomerOrganizationPort;
  managedKeys: ConnectManagedKeyPort;
  contractBudgets: ContractBudgetSyncPort;
  /** Invoices the seats a mid-term seat change added. */
  seatBilling: SeatChangeBillingPort;
  /** The signing key from the server secret, or undefined when none is set. */
  signingKey: () => string | undefined;
  /** The key licenses are verified against. */
  publicKey: string;
  /** Encrypts a license held for delivery. */
  encrypt: (plain: string) => string;
  now?: () => Date;
}

/** The customer a license is issued to: one that exists, or a new one to create. */
export type LicenseCustomer =
  | { organizationId: string }
  | { newOrganizationName: string };

export interface LicenseTermsInput {
  services?: ConnectService[];
  seatRateCents?: number | null;
  seatCurrency?: SeatCurrency | null;
  commitUsdCents?: number;
  overageEnabled?: boolean;
  overageMaxUsdCents?: number | null;
}

/** Revoked wins over superseded, which wins over the term. */
export function statusOfIssuedLicense(
  row: Pick<IssuedLicenseRecord, "revokedAt" | "supersededAt" | "expiresAt">,
  now: Date,
): IssuedLicenseStatus {
  if (row.revokedAt) return "revoked";
  if (row.supersededAt) return "superseded";
  if (now >= row.expiresAt) return "expired";
  return "active";
}
