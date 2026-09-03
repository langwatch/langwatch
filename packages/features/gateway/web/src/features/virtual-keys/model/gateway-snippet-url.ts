/** SaaS fallback shown before the HTML boot configuration is available. */
export const HOSTED_GATEWAY_URL = "https://gateway.langwatch.ai/v1";

/**
 * Resolve the `base_url` embedded in the AI Gateway copy-paste snippets.
 *
 * Priority:
 *   1. `override`: explicit prop (already a full base_url incl. `/v1`).
 *   2. `deploymentBaseUrl`: this deployment's own gateway URL from
 *      HTML boot config (`GATEWAY_BASE_URL` compatibility view), returned
 *      WITHOUT the `/v1` suffix the
 *      OpenAI `base_url` needs, so it is appended here. This is what makes
 *      self-hosted installs show their own ingress instead of the SaaS URL.
 *   3. SaaS fallback when rendering outside the application shell.
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
