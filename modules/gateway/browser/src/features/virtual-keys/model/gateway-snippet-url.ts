/** SaaS fallback shown before the HTML boot configuration is available. */
export const HOSTED_GATEWAY_URL = "https://gateway.langwatch.ai/v1";

/**
 * Resolve the `base_url` embedded in the copy-paste snippet, prioritizing
 * override > deployment URL (from HTML boot config) > SaaS fallback.
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
