// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SSO_SIGN_IN_PROVIDER_AGGREGATE_TYPE,
  SSO_SIGN_IN_PROVIDER_RECORDED_EVENT_TYPE,
  SSO_SIGN_IN_PROVIDER_RECORDED_EVENT_VERSION,
  ssoSignInProviderRecordedEventDataSchema,
} from "@langwatch/enterprise-sso-contract";
import { defineCommand, EventSchema } from "@langwatch/eventing";
import { z } from "zod";

/** One aggregate for the deployment, on the tenant scheduled singletons use (ops' operator seed). */
export const SSO_SIGN_IN_PROVIDER_TENANT_ID = "__global__" as const;
const SSO_SIGN_IN_PROVIDER_AGGREGATE_ID = "deployment";

export const ssoSignInProviderRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SSO_SIGN_IN_PROVIDER_RECORDED_EVENT_TYPE),
  version: z.literal(SSO_SIGN_IN_PROVIDER_RECORDED_EVENT_VERSION),
  data: ssoSignInProviderRecordedEventDataSchema,
});
export type SsoSignInProviderRecordedEvent = z.infer<typeof ssoSignInProviderRecordedEventSchema>;

/** Keyed on what mounted and when, so a crash replay of one mount lands once. */
export const RecordSsoSignInProviderCommand = defineCommand({
  commandType: "lw.sso.sign_in_provider.record",
  eventType: SSO_SIGN_IN_PROVIDER_RECORDED_EVENT_TYPE,
  eventVersion: SSO_SIGN_IN_PROVIDER_RECORDED_EVENT_VERSION,
  aggregateType: SSO_SIGN_IN_PROVIDER_AGGREGATE_TYPE,
  schema: ssoSignInProviderRecordedEventDataSchema,
  aggregateId: () => SSO_SIGN_IN_PROVIDER_AGGREGATE_ID,
  idempotencyKey: ({ provider, mounted, occurredAt }) =>
    `sso_sign_in_provider:${provider ?? "email"}:${String(mounted)}:${occurredAt}`,
});
