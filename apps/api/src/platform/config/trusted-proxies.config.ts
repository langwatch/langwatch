import { RuntimeConfig, trustedProxyConfigDefinition } from "@langwatch/config";

/**
 * The hops `TRUSTED_PROXY_ADDRESSES` trusts to state a client address.
 * Three-valued: `undefined` falls back to classifying the peer by address,
 * `[]` is an explicit "trust nothing". So PRESENCE is asked of the variable,
 * not the parsed value — `RuntimeConfig` reads `FOO=` as absent, right
 * wherever a default exists and wrong here.
 */
let cached: { raw: string | undefined; value: readonly string[] | undefined } | undefined;

export function configuredTrustedProxies(): readonly string[] | undefined {
  const raw = process.env.TRUSTED_PROXY_ADDRESSES;
  if (cached !== undefined && cached.raw === raw) return cached.value;

  const value = raw === undefined ? undefined : parsedTrustedProxies();
  cached = { raw, value };
  return value;
}

function parsedTrustedProxies(): readonly string[] {
  const configured = RuntimeConfig.create({
    name: "api trusted proxies",
    definition: trustedProxyConfigDefinition,
    source: process.env,
  }).value.trustedProxies;
  return (configured ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
