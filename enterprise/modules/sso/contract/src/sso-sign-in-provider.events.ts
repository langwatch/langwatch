import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/** The deployment's sign-in provider, recorded by sso when it shapes them for Better Auth (ADR-179). */
export const SSO_SIGN_IN_PROVIDER_AGGREGATE_TYPE = "sso_sign_in_provider" as const;
export const SSO_SIGN_IN_PROVIDER_RECORDED_EVENT_TYPE = "lw.sso.sign_in_provider.recorded" as const;
export const SSO_SIGN_IN_PROVIDER_RECORDED_EVENT_VERSION = "2026-10-11" as const;

/** `provider` is the configured name, `null` for email; `mounted` whether this build mounted it. */
const ssoSignInProviderRecordedEventDataSchemaDefinition = z.object({
  provider: z.string().nullable(),
  mounted: z.boolean(),
});
export interface SsoSignInProviderRecordedEventDataSchema extends Named<
  typeof ssoSignInProviderRecordedEventDataSchemaDefinition
> {}
export const ssoSignInProviderRecordedEventDataSchema: SsoSignInProviderRecordedEventDataSchema =
  ssoSignInProviderRecordedEventDataSchemaDefinition;
export type SsoSignInProviderRecordedEventData = z.infer<
  typeof ssoSignInProviderRecordedEventDataSchema
>;
