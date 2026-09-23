import { CLOUD_ENDPOINT } from "@langwatch/onboarding-browser-kit";

/**
 * The endpoint a reader has to set, or null when the SDK's own default already points
 * at this deployment.
 */
export function selfHostedEndpoint(baseHost: string | undefined): string | null {
  if (!baseHost || baseHost === CLOUD_ENDPOINT) return null;
  return baseHost;
}
