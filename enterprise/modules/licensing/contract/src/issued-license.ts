// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The license registry as everything outside the feature reads it (ADR-156).
 * The stored row is the feature's own state and stays in its process half; what
 * crosses is the view, whose timestamps are ISO strings because they go on a
 * wire.
 */

import type { ConnectService } from "./connect-services.ts";

export type IssuedLicenseSource = "BACKOFFICE" | "PURCHASE" | "SCRIPT" | "LEGACY_IMPORT";

/** The currencies a seat contract is priced in, as the schema's `Currency` enum has them. */
export type SeatCurrency = "USD" | "EUR";

export type IssuedLicenseStatus = "active" | "revoked" | "superseded" | "expired";

/** A registry row as an operator surface reads it, without the held license. */
export interface IssuedLicenseView {
  id: string;
  licenseId: string;
  tokenHash: string;
  organizationId: string | null;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  maxMembersLite: number;
  issuedAt: string;
  expiresAt: string;
  source: IssuedLicenseSource;
  issuedById: string | null;
  revokedAt: string | null;
  revokedById: string | null;
  revokedReason: string | null;
  supersededAt: string | null;
  replacesId: string | null;
  services: string[];
  seatRateCents: number | null;
  seatCurrency: SeatCurrency | null;
  commitUsdCents: number;
  overageEnabled: boolean;
  overageMaxUsdCents: number | null;
  instanceId: string | null;
  instanceBoundAt: string | null;
  lastSyncAt: string | null;
  lastSyncVersion: string | null;
  reportedMembers: number | null;
  reportedMembersLite: number | null;
  virtualKeyId: string | null;
  createdAt: string;
  updatedAt: string;
  status: IssuedLicenseStatus;
  /** Whether a reissued license is waiting to be delivered to its install. */
  hasPendingDelivery: boolean;
}

/** The customer organization a license is attributed to, as the registry needs it. */
export interface IssuedLicenseCustomerRecord {
  id: string;
  name: string;
}

/** The customer a license is issued to: one that exists, or a new one to create. */
export type LicenseCustomer = { organizationId: string } | { newOrganizationName: string };

/** The commercial terms an operator sets on a license. */
export interface LicenseTermsInput {
  services?: ConnectService[];
  seatRateCents?: number | null;
  seatCurrency?: SeatCurrency | null;
  commitUsdCents?: number;
  overageEnabled?: boolean;
  overageMaxUsdCents?: number | null;
}

/**
 * What a mid-term seat change owes. The registry only names the change; billing
 * decides the amount and keeps the invoice from being raised twice.
 */
export type SeatChangeBillingOutcome = "invoiced" | "nothing_to_invoice" | "not_onboarded";

/** One page of registry rows, as an operator surface reads them. */
export interface IssuedLicensePage {
  licenses: IssuedLicenseView[];
  total: number;
}

/**
 * What a hosted route learns from a presented license token: who to attribute
 * the call to, and the terms that bound it. Never the token, never the seats.
 */
export interface ConnectCredentialGrant {
  licenseRowId: string;
  licenseId: string;
  organizationId: string;
  instanceId: string;
  virtualKeyId: string;
  services: string[];
  commitUsdCents: number;
  overageEnabled: boolean;
  overageMaxUsdCents: number | null;
}
