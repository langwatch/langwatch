// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/** Licensing's facts about the customers it licenses; organization applies them (R42). */
export const LICENSING_CUSTOMER_AGGREGATE_TYPE = "licensing_customer" as const;
export const LICENSING_CUSTOMER_EVENT_VERSION = "2026-10-09" as const;
export const SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE =
  "lw.licensing.self_hosted_customer_licensed" as const;

/** An operator licensed a new self-hosted customer; organization creates its row under this id. */
export const selfHostedCustomerLicensedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  name: z.string().min(1),
});
export type SelfHostedCustomerLicensedEventData = z.infer<
  typeof selfHostedCustomerLicensedEventDataSchema
>;

export const CONNECT_SERVICE_SWITCHED_EVENT_TYPE = "lw.licensing.connect_service_switched" as const;
export const LICENSE_SYNC_FINISHED_EVENT_TYPE = "lw.licensing.license_sync_finished" as const;

/** An administrator switched one hosted service on or off; organization keeps the refusals. */
export const connectServiceSwitchedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  service: z.string().min(1),
  enabled: z.boolean(),
});
export type ConnectServiceSwitchedEventData = z.infer<typeof connectServiceSwitchedEventDataSchema>;

/** A license sync ended at `occurredAt`: `error` names its code, null when it landed. */
export const licenseSyncFinishedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  error: z.string().min(1).nullable(),
});
export type LicenseSyncFinishedEventData = z.infer<typeof licenseSyncFinishedEventDataSchema>;

export const LICENSE_STORED_EVENT_TYPE = "lw.licensing.license_stored" as const;
export const LICENSE_CLEARED_EVENT_TYPE = "lw.licensing.license_cleared" as const;

/**
 * Licensing stored an organization's licence. The fact names the key by its sha256 hex
 * fingerprint, never the key; organization reads the key from licensing's row (C3-KEY-HASH).
 */
export const licenseStoredEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  licenseKeyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.number().int(),
  validatedAt: z.number().int().nullable(),
});
export type LicenseStoredEventData = z.infer<typeof licenseStoredEventDataSchema>;

/** Licensing cleared an organization's licence; organization clears its columns. */
export const licenseClearedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
});
export type LicenseClearedEventData = z.infer<typeof licenseClearedEventDataSchema>;

export const MANAGED_KEY_RETIRED_EVENT_TYPE = "lw.licensing.managed_key_retired" as const;
export const MANAGED_KEY_INVALIDATED_EVENT_TYPE = "lw.licensing.managed_key_invalidated" as const;

/** Licensing ended a licence's managed key for good; gateway revokes it, safe to repeat. */
export const managedKeyRetiredEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  virtualKeyId: z.string().min(1),
  actorId: z.string().min(1),
});
export type ManagedKeyRetiredEventData = z.infer<typeof managedKeyRetiredEventDataSchema>;

/** Licensing changed what a managed key's licence resolves to; gateway tells every gateway. */
export const managedKeyInvalidatedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  virtualKeyId: z.string().min(1),
});
export type ManagedKeyInvalidatedEventData = z.infer<typeof managedKeyInvalidatedEventDataSchema>;

export const CONNECT_CREDENTIAL_ISSUED_EVENT_TYPE =
  "lw.licensing.connect_credential_issued" as const;

/**
 * A licence's call found no managed key; gateway provisions one, writes these facts on it, then
 * records `lw.gateway.managed_key_provisioned`. Names the token by its registry hash, never a secret.
 */
export const connectCredentialIssuedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  licenseId: z.string().min(1),
  issuedLicenseId: z.string().min(1),
  instanceId: z.string().min(1),
  tokenHash: z.string().min(1),
  expiresAt: z.number().int(),
  services: z.array(z.string().min(1)),
});
export type ConnectCredentialIssuedEventData = z.infer<
  typeof connectCredentialIssuedEventDataSchema
>;
