/** SaaS fallback shown during SSR / before the publicEnv query resolves. */
export const HOSTED_GATEWAY_URL = "https://gateway.langwatch.ai/v1";

/**
 * Resolve the `base_url` embedded in the AI Gateway copy-paste snippets.
 *
 * Priority:
 *   1. `override`: explicit prop (already a full base_url incl. `/v1`).
 *   2. `deploymentBaseUrl`: this deployment's own gateway URL from
 *      publicEnv (`GATEWAY_BASE_URL`), returned WITHOUT the `/v1` suffix the
 *      OpenAI `base_url` needs, so it is appended here. This is what makes
 *      self-hosted installs show their own ingress instead of the SaaS URL.
 *   3. SaaS fallback while publicEnv is still loading.
 */
export function resolveSnippetGatewayBaseUrl(
  override: string | undefined,
  deploymentBaseUrl: string | null | undefined,
): string {
  if (override) return override;
  if (deploymentBaseUrl) {
    return `${deploymentBaseUrl.replace(/\/+$/, "")}/v1`;
  }
  return HOSTED_GATEWAY_URL;
}
