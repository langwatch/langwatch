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

let processOutboundProxyConfig: OutboundProxyConfig | undefined;

const readProxyEnvironmentValue = (
  source: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined => {
  const value = source[name] ?? source[name.toLowerCase()];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Parses proxy compatibility spellings once at process boot. */
export function parseOutboundProxyConfig(
  source: Readonly<Record<string, string | undefined>>,
): OutboundProxyConfig {
  return {
    httpsProxy: readProxyEnvironmentValue(source, "HTTPS_PROXY"),
    httpProxy: readProxyEnvironmentValue(source, "HTTP_PROXY"),
    noProxy: readProxyEnvironmentValue(source, "NO_PROXY"),
  };
}

/** Installs the config parsed by the process composition root. */
export function configureProcessOutboundProxy(config: OutboundProxyConfig): void {
  processOutboundProxyConfig = config;
}

export function getProcessOutboundProxyConfig(): Readonly<OutboundProxyConfig> {
  return processOutboundProxyConfig ?? {};
}

/**
 * The proxy that applies to `targetHost`, or undefined when none is configured
 * or the host is excluded via `NO_PROXY`.
 *
 * `HTTPS_PROXY` wins over `HTTP_PROXY` because every gateway here uses TLS.
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
 * Hostname of a URL, or the input unchanged when it is already a bare host.
 *
 * A scheme-less `host:port` parses as a URL whose scheme is `host:` and whose
 * hostname is empty, so the parsed result is only trusted when it is non-empty.
 */
export const hostnameOf = (urlOrHost: string): string => {
  try {
    const hostname = new URL(urlOrHost).hostname;
    if (hostname) return hostname;
  } catch {
    // Not a URL; fall through to the bare-host handling below.
  }
  const withoutScheme = urlOrHost.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostPort = withoutScheme.split("/")[0] ?? "";
  return hostPort.replace(/:\d+$/, "") || urlOrHost;
};
