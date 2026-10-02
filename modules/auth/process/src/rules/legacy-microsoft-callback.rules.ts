import {
  MICROSOFT_LEGACY_CALLBACK_ID,
  MICROSOFT_PROVIDER_CALLBACK_ID,
} from "@langwatch/enterprise-sso-contract/sign-in-providers";

const LEGACY_PATH = `/api/auth/callback/${MICROSOFT_LEGACY_CALLBACK_ID}`;
const PROVIDER_PATH = `/api/auth/callback/${MICROSOFT_PROVIDER_CALLBACK_ID}`;

export type MicrosoftCallbackRoute = { kind: "pass" } | { kind: "forward"; url: string };

/**
 * The Microsoft callback arriving at the path Azure app registrations list is
 * handed to Better Auth under the provider's own path
 * (specs/auth/azure-ad-account-upgrade.feature). Anything else passes as is.
 */
export function microsoftCallbackRouteOf({ url }: { url: string }): MicrosoftCallbackRoute {
  const parsed = new URL(url);
  if (parsed.pathname !== LEGACY_PATH) return { kind: "pass" };
  parsed.pathname = PROVIDER_PATH;
  return { kind: "forward", url: parsed.toString() };
}
