import { z } from "zod";

/** Gateway's facts about a self-hosted licence's managed key (C3b); licensing attaches the key. */
export const GATEWAY_CONNECT_MANAGED_KEY_AGGREGATE_TYPE = "gateway_connect_managed_key" as const;
export const GATEWAY_CONNECT_MANAGED_KEY_EVENT_VERSION = "2026-10-09" as const;
export const GATEWAY_MANAGED_KEY_PROVISIONED_EVENT_TYPE =
  "lw.gateway.managed_key_provisioned" as const;

/** Gateway holds this licence's managed key and has written its services and licence on it. */
export const gatewayManagedKeyProvisionedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  licenseId: z.string().min(1),
  issuedLicenseId: z.string().min(1),
  virtualKeyId: z.string().min(1),
});
export type GatewayManagedKeyProvisionedEventData = z.infer<
  typeof gatewayManagedKeyProvisionedEventDataSchema
>;
