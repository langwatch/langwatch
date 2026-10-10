import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/** Licensing's facts about the customers it licenses; organization applies them (R42). */
export const LICENSING_CUSTOMER_AGGREGATE_TYPE = "licensing_customer" as const;
export const LICENSING_CUSTOMER_EVENT_VERSION = "2026-10-09" as const;
export const SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE =
  "lw.licensing.self_hosted_customer_licensed" as const;

/** An operator licensed a new self-hosted customer; organization creates its row under this id. */
const selfHostedCustomerLicensedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  name: z.string().min(1),
});
export interface SelfHostedCustomerLicensedEventDataSchema extends Named<
  typeof selfHostedCustomerLicensedEventDataSchemaDefinition
> {}
export const selfHostedCustomerLicensedEventDataSchema: SelfHostedCustomerLicensedEventDataSchema =
  selfHostedCustomerLicensedEventDataSchemaDefinition;
export type SelfHostedCustomerLicensedEventData = z.infer<
  typeof selfHostedCustomerLicensedEventDataSchema
>;

export const CONNECT_SERVICE_SWITCHED_EVENT_TYPE = "lw.licensing.connect_service_switched" as const;
export const LICENSE_SYNC_FINISHED_EVENT_TYPE = "lw.licensing.license_sync_finished" as const;

/** An administrator switched one hosted service on or off; organization keeps the refusals. */
const connectServiceSwitchedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  service: z.string().min(1),
  enabled: z.boolean(),
});
export interface ConnectServiceSwitchedEventDataSchema extends Named<
  typeof connectServiceSwitchedEventDataSchemaDefinition
> {}
export const connectServiceSwitchedEventDataSchema: ConnectServiceSwitchedEventDataSchema =
  connectServiceSwitchedEventDataSchemaDefinition;
export type ConnectServiceSwitchedEventData = z.infer<typeof connectServiceSwitchedEventDataSchema>;

/** A license sync ended at `occurredAt`: `error` names its code, null when it landed. */
const licenseSyncFinishedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  error: z.string().min(1).nullable(),
});
export interface LicenseSyncFinishedEventDataSchema extends Named<
  typeof licenseSyncFinishedEventDataSchemaDefinition
> {}
export const licenseSyncFinishedEventDataSchema: LicenseSyncFinishedEventDataSchema =
  licenseSyncFinishedEventDataSchemaDefinition;
export type LicenseSyncFinishedEventData = z.infer<typeof licenseSyncFinishedEventDataSchema>;

export const LICENSE_STORED_EVENT_TYPE = "lw.licensing.license_stored" as const;
export const LICENSE_CLEARED_EVENT_TYPE = "lw.licensing.license_cleared" as const;

/**
 * Licensing stored an organization's licence. The fact names the key by its sha256 hex
 * fingerprint, never the key; organization reads the key from licensing's row (C3-KEY-HASH).
 */
const licenseStoredEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  licenseKeyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.number().int(),
  validatedAt: z.number().int().nullable(),
});
export interface LicenseStoredEventDataSchema extends Named<
  typeof licenseStoredEventDataSchemaDefinition
> {}
export const licenseStoredEventDataSchema: LicenseStoredEventDataSchema =
  licenseStoredEventDataSchemaDefinition;
export type LicenseStoredEventData = z.infer<typeof licenseStoredEventDataSchema>;

/** Licensing cleared an organization's licence; organization clears its columns. */
const licenseClearedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
});
export interface LicenseClearedEventDataSchema extends Named<
  typeof licenseClearedEventDataSchemaDefinition
> {}
export const licenseClearedEventDataSchema: LicenseClearedEventDataSchema =
  licenseClearedEventDataSchemaDefinition;
export type LicenseClearedEventData = z.infer<typeof licenseClearedEventDataSchema>;

export const MANAGED_KEY_RETIRED_EVENT_TYPE = "lw.licensing.managed_key_retired" as const;
export const MANAGED_KEY_INVALIDATED_EVENT_TYPE = "lw.licensing.managed_key_invalidated" as const;

/** Licensing ended a licence's managed key for good; gateway revokes it, safe to repeat. */
const managedKeyRetiredEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  virtualKeyId: z.string().min(1),
  actorId: z.string().min(1),
});
export interface ManagedKeyRetiredEventDataSchema extends Named<
  typeof managedKeyRetiredEventDataSchemaDefinition
> {}
export const managedKeyRetiredEventDataSchema: ManagedKeyRetiredEventDataSchema =
  managedKeyRetiredEventDataSchemaDefinition;
export type ManagedKeyRetiredEventData = z.infer<typeof managedKeyRetiredEventDataSchema>;

/** Licensing changed what a managed key's licence resolves to; gateway tells every gateway. */
const managedKeyInvalidatedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  virtualKeyId: z.string().min(1),
});
export interface ManagedKeyInvalidatedEventDataSchema extends Named<
  typeof managedKeyInvalidatedEventDataSchemaDefinition
> {}
export const managedKeyInvalidatedEventDataSchema: ManagedKeyInvalidatedEventDataSchema =
  managedKeyInvalidatedEventDataSchemaDefinition;
export type ManagedKeyInvalidatedEventData = z.infer<typeof managedKeyInvalidatedEventDataSchema>;

export const MANAGED_KEY_LICENSE_SET_EVENT_TYPE = "lw.licensing.managed_key_license_set" as const;
export const MANAGED_KEY_SERVICES_SET_EVENT_TYPE = "lw.licensing.managed_key_services_set" as const;

/** The licence a managed key serves, by its token's registry hash only; gateway rewrites it. */
const managedKeyLicenseSetEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  virtualKeyId: z.string().min(1),
  tokenHash: z.string().min(1),
  instanceId: z.string().min(1).nullable(),
  expiresAt: z.number().int().nullable(),
});
export interface ManagedKeyLicenseSetEventDataSchema extends Named<
  typeof managedKeyLicenseSetEventDataSchemaDefinition
> {}
export const managedKeyLicenseSetEventDataSchema: ManagedKeyLicenseSetEventDataSchema =
  managedKeyLicenseSetEventDataSchemaDefinition;
export type ManagedKeyLicenseSetEventData = z.infer<typeof managedKeyLicenseSetEventDataSchema>;

/** The platform services a managed key may serve, replaced whole; gateway rewrites them. */
const managedKeyServicesSetEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  virtualKeyId: z.string().min(1),
  services: z.array(z.string().min(1)),
});
export interface ManagedKeyServicesSetEventDataSchema extends Named<
  typeof managedKeyServicesSetEventDataSchemaDefinition
> {}
export const managedKeyServicesSetEventDataSchema: ManagedKeyServicesSetEventDataSchema =
  managedKeyServicesSetEventDataSchemaDefinition;
export type ManagedKeyServicesSetEventData = z.infer<typeof managedKeyServicesSetEventDataSchema>;

export const CONNECT_UPSTREAM_SET_EVENT_TYPE = "lw.licensing.connect_upstream_set" as const;
export const CONNECT_UPSTREAM_CLEARED_EVENT_TYPE = "lw.licensing.connect_upstream_cleared" as const;

/**
 * Licensing decided an organization's gateway reaches LangWatch-hosted models (set) or not
 * (cleared). Ids only: gateway pulls the token through `LicensingApi.findConnectUpstream`.
 */
const connectUpstreamChangedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
});
export interface ConnectUpstreamChangedEventDataSchema extends Named<
  typeof connectUpstreamChangedEventDataSchemaDefinition
> {}
export const connectUpstreamChangedEventDataSchema: ConnectUpstreamChangedEventDataSchema =
  connectUpstreamChangedEventDataSchemaDefinition;
export type ConnectUpstreamChangedEventData = z.infer<typeof connectUpstreamChangedEventDataSchema>;

export const CONNECT_CREDENTIAL_ISSUED_EVENT_TYPE =
  "lw.licensing.connect_credential_issued" as const;

/**
 * A licence's call found no managed key; gateway provisions one, writes these facts on it, then
 * records `lw.gateway.managed_key_provisioned`. Names the token by its registry hash, never a secret.
 */
const connectCredentialIssuedEventDataSchemaDefinition = z.object({
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
export interface ConnectCredentialIssuedEventDataSchema extends Named<
  typeof connectCredentialIssuedEventDataSchemaDefinition
> {}
export const connectCredentialIssuedEventDataSchema: ConnectCredentialIssuedEventDataSchema =
  connectCredentialIssuedEventDataSchemaDefinition;
export type ConnectCredentialIssuedEventData = z.infer<
  typeof connectCredentialIssuedEventDataSchema
>;

export const CONTRACT_TERMS_CHANGED_EVENT_TYPE = "lw.licensing.contract_terms_changed" as const;

/**
 * A customer's contract terms may have moved (a licence issued, revoked, changed or linked);
 * connect brings the contract budget in line with the terms licensing answers now.
 */
const contractTermsChangedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  operatorId: z.string().min(1),
});
export interface ContractTermsChangedEventDataSchema extends Named<
  typeof contractTermsChangedEventDataSchemaDefinition
> {}
export const contractTermsChangedEventDataSchema: ContractTermsChangedEventDataSchema =
  contractTermsChangedEventDataSchemaDefinition;
export type ContractTermsChangedEventData = z.infer<typeof contractTermsChangedEventDataSchema>;
