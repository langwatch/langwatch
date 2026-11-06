/**
 * Outbound proxy resolution for vendor HTTPS calls: the AWS SDK doesn't honour `HTTPS_PROXY`
 * on its own, so self-hosted deployments behind a corporate proxy need it wired in explicitly.
 * SMTP is excluded — an SMTP relay is usually reachable directly, so a global proxy would break it.
 */

export interface OutboundProxyConfig {
  httpsProxy?: string;
  httpProxy?: string;
  noProxy?: string;
}

const readProxyEnvironmentValue = (
  source: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined => {
  const value = source[name] ?? source[name.toLowerCase()];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Parses proxy compatibility spellings once, from the owning module's declared config. */
export function parseOutboundProxyConfig(
  source: Readonly<Record<string, string | undefined>>,
): OutboundProxyConfig {
  return {
    httpsProxy: readProxyEnvironmentValue(source, "HTTPS_PROXY"),
    httpProxy: readProxyEnvironmentValue(source, "HTTP_PROXY"),
    noProxy: readProxyEnvironmentValue(source, "NO_PROXY"),
  };
}

/**
 * Whether Node sends its global `fetch` through `HTTPS_PROXY` itself: `NODE_USE_ENV_PROXY=1`, or
 * `--use-env-proxy` in `NODE_OPTIONS`. Libraries that use global `fetch` follow it.
 */
export function globalFetchUsesEnvProxy(source: {
  NODE_USE_ENV_PROXY?: boolean;
  NODE_OPTIONS?: string;
}): boolean {
  if (source.NODE_USE_ENV_PROXY === true) return true;
  return (source.NODE_OPTIONS ?? "").split(/\s+/).includes("--use-env-proxy");
}

/**
 * The proxy that applies to `targetHost`, or undefined when none is
 * configured or the host is excluded via `NO_PROXY`. `HTTPS_PROXY` wins
 * over `HTTP_PROXY` because every gateway here uses TLS.
 */
export const resolveProxyForHost = (
  config: OutboundProxyConfig,
  targetHost: string,
): string | undefined => {
  const proxy = config.httpsProxy ?? config.httpProxy;
  if (!proxy) return undefined;
  if (isProxyBypassed(config, targetHost)) return undefined;
  return proxy;
};

/**
 * The proxy for a destination with a known scheme: `HTTP_PROXY` carries `http:`,
 * `HTTPS_PROXY` carries `https:`, each falling back to the other when unset.
 * Undefined when neither is set or `NO_PROXY` excludes the host.
 */
export function resolveProxyForDestination({
  config,
  hostname,
  protocol,
}: {
  config: OutboundProxyConfig;
  hostname: string;
  protocol: string;
}): string | undefined {
  const proxy =
    protocol === "http:"
      ? (config.httpProxy ?? config.httpsProxy)
      : (config.httpsProxy ?? config.httpProxy);
  if (!proxy) return undefined;
  if (isProxyBypassed(config, hostname)) return undefined;
  return proxy;
}

/**
 * Whether `NO_PROXY` excludes this host. Follows the de-facto convention:
 * comma separated entries, `*` disables proxying entirely, a leading dot or
 * bare domain matches subdomains, and an optional `:port` suffix is ignored.
 */
export const isProxyBypassed = (config: OutboundProxyConfig, targetHost: string): boolean => {
  const noProxy = config.noProxy;
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

/**
 * Hostname of a URL, or the input unchanged if already a bare host. A
 * scheme-less `host:port` parses with scheme `host:` and empty hostname,
 * so the parsed result is only trusted when non-empty.
 */
export const hostnameOf = (urlOrHost: string): string => {
  const parsed = findUrlHostname(urlOrHost);
  if (parsed) return parsed;
  const withoutScheme = urlOrHost.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostPort = withoutScheme.split("/")[0] ?? "";
  return hostPort.replace(/:\d+$/, "") || urlOrHost;
};

/** The hostname of a full URL, or undefined when the string is not one. */
function findUrlHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname || void 0;
  } catch {
    // Not a URL: the caller reads the bare host out of the string itself.
    return void 0;
  }
}
