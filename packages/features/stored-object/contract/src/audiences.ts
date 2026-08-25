import {
  ALL_PERMISSIONS,
  isRegistryPermission,
  type AuthzPermission,
} from "@langwatch/authz-contract";
import { z } from "zod";

type RegisteredDeliveryAudience = Extract<AuthzPermission, `${string}:view`>;

function isDeliveryAudience(
  permission: AuthzPermission,
): permission is RegisteredDeliveryAudience {
  return permission.endsWith(":view");
}

/**
 * Delivery is granted only to registered read permissions. The values are
 * derived from the shared authorization vocabulary so new read audiences are
 * explicit authz additions rather than arbitrary strings.
 */
export const STORED_OBJECT_DELIVERY_AUDIENCES = ALL_PERMISSIONS.filter(
  isDeliveryAudience,
) as [RegisteredDeliveryAudience, ...RegisteredDeliveryAudience[]];

export const storedObjectDeliveryAudienceSchema = z.enum(
  STORED_OBJECT_DELIVERY_AUDIENCES,
);
export type StoredObjectDeliveryAudience = z.infer<
  typeof storedObjectDeliveryAudienceSchema
>;

/** Runtime guard for data that has crossed a persistence or transport boundary. */
export function isStoredObjectDeliveryAudience(
  value: string,
): value is StoredObjectDeliveryAudience {
  return isRegistryPermission(value) && value.endsWith(":view");
}

export const LEGACY_PURPOSE_AUDIENCE = {
  scenario_event: "scenarios:view",
  trace_content: "traces:view",
  evaluation_inputs: "evaluations:view",
} as const satisfies Record<string, StoredObjectDeliveryAudience>;

export const legacyStoredObjectPurposeSchema = z.enum([
  "scenario_event",
  "trace_content",
  "evaluation_inputs",
]);
export type LegacyStoredObjectPurpose = z.infer<
  typeof legacyStoredObjectPurposeSchema
>;

/** Unknown legacy purposes intentionally have no broad fallback audience. */
export function audienceForLegacyStoredObjectPurpose(
  purpose: string,
): StoredObjectDeliveryAudience | undefined {
  if (!(purpose in LEGACY_PURPOSE_AUDIENCE)) return undefined;
  return LEGACY_PURPOSE_AUDIENCE[purpose as LegacyStoredObjectPurpose];
}
