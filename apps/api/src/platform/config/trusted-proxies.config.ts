import { RuntimeConfig, trustedProxyConfigDefinition } from "@langwatch/config";

/**
 * The proxy hops this deployment trusts to state a client address, from
 * `TRUSTED_PROXY_ADDRESSES` (empty by default).
 */
let cached: { raw: string | undefined; value: readonly string[] } | undefined;

export function configuredTrustedProxies(): readonly string[] {
  const raw = process.env.TRUSTED_PROXY_ADDRESSES;
  if (cached !== undefined && cached.raw === raw) return cached.value;

  const configured = RuntimeConfig.create({
    name: "api trusted proxies",
    definition: trustedProxyConfigDefinition,
    source: process.env,
  }).value.trustedProxies;
  const value = (configured ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  cached = { raw, value };
  return value;
}
