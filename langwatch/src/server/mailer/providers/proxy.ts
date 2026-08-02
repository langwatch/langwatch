/**
 * Outbound proxy resolution for email gateways.
 *
 * Many self-hosted deployments can only reach the public internet through a
 * corporate HTTP proxy. The AWS SDK does not honour `HTTPS_PROXY` on its own,
 * so any gateway that talks HTTPS to a vendor consults these helpers and wires
 * the proxy into its own transport.
 *
 * Only vendor HTTPS calls opt in. An SMTP relay is usually an internal host
 * that is reachable directly, so applying a globally-set proxy to it would
 * break working deployments; the SMTP gateway deliberately does not.
 */

const readEnv = (name: string): string | undefined => {
  const value = process.env[name] ?? process.env[name.toLowerCase()];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * The proxy that applies to `targetHost`, or undefined when none is configured
 * or the host is excluded via `NO_PROXY`.
 *
 * `HTTPS_PROXY` wins over `HTTP_PROXY` because every gateway here uses TLS.
 */
export const resolveProxyForHost = (targetHost: string): string | undefined => {
  const proxy = readEnv("HTTPS_PROXY") ?? readEnv("HTTP_PROXY");
  if (!proxy) return undefined;
  if (isProxyBypassed(targetHost)) return undefined;
  return proxy;
};

/**
 * Whether `NO_PROXY` excludes this host. Follows the de-facto convention:
 * comma separated entries, `*` disables proxying entirely, a leading dot or
 * bare domain matches subdomains, and an optional `:port` suffix is ignored.
 */
export const isProxyBypassed = (targetHost: string): boolean => {
  const noProxy = readEnv("NO_PROXY");
  if (!noProxy) return false;

  const host = targetHost.toLowerCase().replace(/:\d+$/, "");

  return noProxy
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      const bare = entry.startsWith(".") ? entry.slice(1) : entry;
      return host === bare || host.endsWith(`.${bare}`);
    });
};

/** Hostname of a URL, or the input unchanged when it is already a bare host. */
export const hostnameOf = (urlOrHost: string): string => {
  try {
    return new URL(urlOrHost).hostname;
  } catch {
    return urlOrHost.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? urlOrHost;
  }
};
