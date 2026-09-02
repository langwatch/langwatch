import { CLOUD_ENDPOINT } from "../../../features/onboarding/components/sections/shared/build-mcp-config";

/**
 * The endpoint a reader has to set, or null when the SDK's own default
 * already points at this deployment.
 *
 * Only a self-hosted deployment needs `LANGWATCH_ENDPOINT`. An empty
 * `BASE_HOST` counts as the default too: emitting `LANGWATCH_ENDPOINT=""`
 * silently breaks the SDK.
 */
export function selfHostedEndpoint(baseHost: string | undefined): string | null {
  if (!baseHost || baseHost === CLOUD_ENDPOINT) return null;
  return baseHost;
}
