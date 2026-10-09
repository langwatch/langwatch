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
