export { BLOCKED_CLOUD_DOMAINS, BLOCKED_METADATA_HOSTS } from "./ssrf/blocked-hosts.ts";
export {
  createSsrfUrlValidator,
  isBlockedCloudDomain,
  isPrivateOrLocalhostIP,
} from "./ssrf/url-validator.ts";
export type {
  SsrfAllowlistedResult,
  SsrfPolicy,
  SsrfResolvedResult,
  SsrfUnresolvedResult,
  SsrfUrlValidator,
  SsrfValidationResult,
} from "./ssrf/url-validator.ts";
export { fetchValidatedDestination, RedirectRefusedError } from "./ssrf/fenced-fetch.ts";
export type { EgressTlsPolicy, FencedFetchOptions } from "./ssrf/fenced-fetch.ts";

/**
 * The corporate proxy self-hosted outbound calls leave through — the
 * egress fence's other half (SSRF decides which addresses, this decides
 * how). Every HTTPS caller resolves it the same way, so no bypass via a second `no_proxy` copy.
 */
export {
  hostnameOf,
  isProxyBypassed,
  parseOutboundProxyConfig,
  resolveProxyForHost,
  type OutboundProxyConfig,
} from "./proxy/outbound-proxy.ts";
