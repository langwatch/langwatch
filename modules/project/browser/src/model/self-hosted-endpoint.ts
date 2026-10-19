/**
 * The endpoint for self-hosted deployments; defaults to cloud when not set.
 * Empty values will silently break the SDK.
 */
const CLOUD_ENDPOINT = "https://app.langwatch.ai";

export function selfHostedEndpoint(baseHost: string | undefined): string | null {
  if (!baseHost || baseHost === CLOUD_ENDPOINT) return null;
  return baseHost;
}
