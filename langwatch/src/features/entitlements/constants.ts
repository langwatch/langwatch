/**
 * Entitlement definitions for LangWatch.
 *
 * Entitlements represent features that can be enabled or disabled
 * based on the user's plan.
 */
export const entitlements = [
  // SSO Providers (free tier)
  "sso-google",
  "sso-github",
  "sso-gitlab",

  // Enterprise Edition only
  "custom-rbac",
] as const;

export type Entitlement = (typeof entitlements)[number];
