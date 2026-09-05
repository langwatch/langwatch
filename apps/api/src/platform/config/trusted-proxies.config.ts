import { RuntimeConfig, trustedProxyConfigDefinition } from "@langwatch/config";

/**
 * The proxy hops this deployment trusts to state a client address, from
 * `TRUSTED_PROXY_ADDRESSES` (empty by default).
 *
 * A config module rather than a value threaded from the process graph: the
 * address resolver is handed a Hono or tRPC request and nothing else, and the
 * list is one process-wide deployment fact. Re-resolved only when the variable
 * itself changes, so a test that restates it is answered with the new list.
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
