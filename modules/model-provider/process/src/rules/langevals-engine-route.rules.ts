import type { PrivateEndpointBindingWire } from "@langwatch/model-provider-contract";

/** The key the proxied call shows nlpgo, which reads the real one from `x-litellm-api_key`. */
export const ENGINE_PROXY_API_KEY = "langwatch-engine-proxy";

function normalizedHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

/** Whether the parameters' base URL names a host the organization bound (ADR-203). */
export function isBoundCall({
  parameters,
  bindings,
}: {
  parameters: Readonly<Record<string, string>>;
  bindings: readonly PrivateEndpointBindingWire[];
}): boolean {
  const url = parameters.api_base ? URL.parse(parameters.api_base) : null;
  if (!url?.hostname) return false;
  const host = normalizedHost(url.hostname);
  return bindings.some((binding) => normalizedHost(binding.hostname) === host);
}

/**
 * The litellm parameters that send a call through nlpgo's proxy: an OpenAI-shape call to the
 * proxy, whose `x-litellm-*` headers carry the original parameters and the signed bindings. nlpgo
 * then dials the bound host the way the playground does: no DNS, hostname kept for TLS.
 */
export function engineProxyParameters({
  parameters,
  proxyBaseUrl,
  privateEndpointsHeaders,
}: {
  parameters: Readonly<Record<string, string>>;
  proxyBaseUrl: string;
  privateEndpointsHeaders: Readonly<Record<string, string>>;
}): Record<string, string> {
  const headers = {
    ...Object.fromEntries(
      Object.entries(parameters).map(([key, value]) => [`x-litellm-${key}`, value]),
    ),
    ...privateEndpointsHeaders,
  };
  return {
    model: `openai/${parameters.model ?? ""}`,
    api_base: proxyBaseUrl,
    api_key: ENGINE_PROXY_API_KEY,
    extra_headers: JSON.stringify(headers),
  };
}
