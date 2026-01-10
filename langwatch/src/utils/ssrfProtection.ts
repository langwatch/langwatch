/**
 * SSRF Protection Module
 *
 * Prevents Server-Side Request Forgery by validating URLs before fetching.
 *
 * ## What's Blocked (Always)
 * - Cloud metadata endpoints: 169.254.169.254, metadata.google.internal, fd00:ec2::254
 * - Cloud provider internal domains: *.amazonaws.com, *.googleapis.com, *.azure.com, etc.
 *   (These may expose unauthenticated services when accessed from within the cloud)
 *
 * ## What's Blocked (Production Only)
 * - IPv4 private: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
 * - IPv6 private: ::1, ::, fc00::/7 (ULA), fe80::/10 (link-local)
 * - IPv4-mapped IPv6: ::ffff:x.x.x.x (extracted and checked as IPv4)
 * - Hostnames resolving to private IPs
 *
 * ## DNS Rebinding Protection
 * Eliminates TOCTOU attacks by:
 * 1. Resolving DNS once during validation
 * 2. Returning resolved IP in SSRFValidationResult
 * 3. Using resolved IP for actual fetch (not original hostname)
 * 4. Setting Host header to original hostname for routing
 *
 * ## Development Mode
 * - Without ALLOWED_PROXY_HOSTS: All localhost/private IPs allowed
 * - With ALLOWED_PROXY_HOSTS: Only listed hosts bypass checks
 * - DNS failures: Allowed (for debugging)
 *
 * ## Production Mode
 * - DNS failures: Fail closed (throw error)
 * - All private/localhost blocked
 *
 * ## Usage
 * ```ts
 * // Recommended: atomic validate-and-fetch
 * const response = await ssrfSafeFetch(url, { method: "POST", body });
 *
 * // Or manual: validate then fetch with resolved IP
 * const validated = await validateUrlForSSRF(url);
 * const response = await fetchWithResolvedIp(validated, { method: "POST" });
 * ```
 *
 * ## Environment Variables
 * - ALLOWED_PROXY_HOSTS: Comma-separated allowlist for dev (e.g., "localhost,127.0.0.1")
 * - NODE_ENV: "development" or "production"
 *
 * @module ssrfProtection
 */

import dns from "dns/promises";
import { isIP } from "net";
import { createLogger } from "./logger";

const logger = createLogger("langwatch:ssrfProtection");

export interface SSRFValidationResult {
  /** Original URL for logging/display */
  originalUrl: string;
  /** URL rewritten to use the resolved IP (for actual fetch) */
  resolvedUrl: string;
  /** The resolved IP address */
  resolvedIp: string;
  /** Original hostname (needed for Host header) */
  hostname: string;
}

/**
 * Cloud provider internal domain patterns that should be blocked.
 * These services may be unauthenticated when accessed from within the cloud environment.
 */
const BLOCKED_CLOUD_DOMAINS = [
  // AWS
  ".amazonaws.com",
  ".aws.amazon.com",
  ".compute.internal", // AWS internal DNS
  // Google Cloud
  ".googleapis.com",
  ".cloud.google.com",
  ".run.app", // Cloud Run
  ".cloudfunctions.net", // Cloud Functions
  // Azure
  ".azure.com",
  ".azurewebsites.net",
  ".windows.net",
  ".azure-api.net",
  // Generic internal
  ".internal",
  ".local",
  ".localhost",
];

/**
 * Checks if hostname matches a blocked cloud provider domain pattern
 */
export function isBlockedCloudDomain(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();
  return BLOCKED_CLOUD_DOMAINS.some(
    (domain) => lowerHostname === domain.slice(1) || lowerHostname.endsWith(domain)
  );
}

/**
 * Checks if an IPv4 address is private, localhost, or link-local
 */
function isPrivateIPv4(ip: string): boolean {
  // Loopback (127.0.0.0/8)
  if (ip.startsWith("127.")) return true;

  // Unspecified
  if (ip === "0.0.0.0") return true;

  // Private ranges (10.0.0.0/8)
  if (ip.startsWith("10.")) return true;

  // Private ranges (192.168.0.0/16)
  if (ip.startsWith("192.168.")) return true;

  // Private ranges (172.16.0.0/12)
  const match172 = ip.match(/^172\.(\d+)\./);
  if (match172 && match172[1]) {
    const second = parseInt(match172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  // Link-local (169.254.0.0/16)
  if (ip.startsWith("169.254.")) return true;

  return false;
}

/**
 * Checks if an IP address (IPv4 or IPv6) is private, localhost, or link-local
 */
export function isPrivateOrLocalhostIP(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // IPv6 loopback
  if (normalized === "::1") return true;

  // IPv6 unspecified (like 0.0.0.0)
  if (normalized === "::") return true;

  // IPv6 Unique Local Addresses (fc00::/7 covers both fc and fd prefixes)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  // IPv6 link-local (fe80::/10)
  if (normalized.startsWith("fe80:")) return true;

  // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x or ::ffff:0:0 style)
  // Format 1: ::ffff:192.168.1.1 (dotted decimal)
  // Format 2: ::ffff:c0a8:0101 (hex representation of IPv4)
  const ipv4MappedMatch = normalized.match(/^::ffff:(.+)$/);
  if (ipv4MappedMatch && ipv4MappedMatch[1]) {
    const mapped = ipv4MappedMatch[1];

    // Check if it's dotted decimal format
    if (mapped.includes(".")) {
      return isPrivateIPv4(mapped);
    }

    // Hex format: ::ffff:7f00:0001 (127.0.0.1 in hex)
    // Parse as two 16-bit hex values representing the IPv4 address
    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch && hexMatch[1] && hexMatch[2]) {
      const high = parseInt(hexMatch[1], 16);
      const low = parseInt(hexMatch[2], 16);
      const reconstructed = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
      return isPrivateIPv4(reconstructed);
    }
  }

  // IPv4 checks
  return isPrivateIPv4(ip);
}

/**
 * Validates URL for SSRF protection and returns resolved IP for safe fetching.
 *
 * Returns the resolved IP so callers MUST use it for the actual request,
 * eliminating the TOCTOU gap between DNS check and fetch.
 *
 * @throws Error with user-friendly message if validation fails or DNS resolution fails in production
 */
export async function validateUrlForSSRF(
  url: string
): Promise<SSRFValidationResult> {
  const isDevelopment = process.env.NODE_ENV === "development";
  const allowedDevHosts = process.env.ALLOWED_PROXY_HOSTS?.split(",") || [];

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL format");
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Always block cloud metadata endpoints (critical security - never allow)
  const metadataHosts = [
    "169.254.169.254",
    "metadata.google.internal",
    "fd00:ec2::254",
    "metadata",
  ];

  if (metadataHosts.includes(hostname)) {
    logger.error(
      {
        url,
        hostname,
        reason: "metadata_endpoint",
      },
      "SSRF attempt blocked: cloud metadata endpoint"
    );
    throw new Error(
      "Access to cloud metadata endpoints is not allowed for security reasons"
    );
  }

  // Block cloud provider internal domains (always, even in dev)
  // These may expose unauthenticated internal services when accessed from within the cloud
  if (isBlockedCloudDomain(hostname)) {
    logger.error(
      {
        url,
        hostname,
        reason: "cloud_internal_domain",
      },
      "SSRF attempt blocked: cloud provider internal domain"
    );
    throw new Error(
      "Access to cloud provider internal domains is not allowed for security reasons"
    );
  }

  // In development, check if host is in allowlist - skip IP resolution
  if (isDevelopment && allowedDevHosts.length > 0) {
    const normalizedAllowed = allowedDevHosts.map((h) => h.trim().toLowerCase());
    if (normalizedAllowed.includes(hostname)) {
      logger.info(
        {
          url,
          hostname,
          allowedHosts: normalizedAllowed,
        },
        "Development mode: allowing request to allowlisted host"
      );
      // For allowlisted hosts in dev, use original URL (no IP pinning needed)
      const ipVersion = isIP(hostname);
      return {
        originalUrl: url,
        resolvedUrl: url,
        resolvedIp: ipVersion !== 0 ? hostname : "allowlisted",
        hostname,
      };
    }
  }

  // Skip localhost/private IP checks in development (unless we have an allowlist)
  const skipPrivateChecks = isDevelopment && allowedDevHosts.length === 0;

  // Check if hostname is a literal IP address
  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    if (!skipPrivateChecks && isPrivateOrLocalhostIP(hostname)) {
      logger.warn(
        {
          url,
          hostname,
          ipVersion,
          reason: "private_ip_literal",
        },
        "SSRF attempt blocked: private or localhost IP address"
      );
      throw new Error(
        "Access to private or localhost IP addresses is not allowed for security reasons"
      );
    }
    // Already an IP, use as-is
    return {
      originalUrl: url,
      resolvedUrl: url,
      resolvedIp: hostname,
      hostname,
    };
  }

  // Resolve hostname to IP addresses and check all results
  let allAddresses: string[] = [];
  try {
    // Check both A (IPv4) and AAAA (IPv6) records
    const promises = [
      dns.resolve(hostname, "A").catch(() => [] as string[]),
      dns.resolve(hostname, "AAAA").catch(() => [] as string[]),
    ];

    const [ipv4Addresses = [], ipv6Addresses = []] =
      await Promise.all(promises);
    allAddresses = [...ipv4Addresses, ...ipv6Addresses];
  } catch (dnsError) {
    // DNS resolution completely failed
    if (isDevelopment) {
      logger.debug(
        {
          url,
          hostname,
          error: dnsError instanceof Error ? dnsError.message : String(dnsError),
        },
        "DNS resolution failed during SSRF check in development"
      );
      // In development, allow proceeding with original URL
      return {
        originalUrl: url,
        resolvedUrl: url,
        resolvedIp: "unresolved-dev",
        hostname,
      };
    }
    // In production, fail closed
    logger.error(
      {
        url,
        hostname,
        error: dnsError instanceof Error ? dnsError.message : String(dnsError),
      },
      "DNS resolution failed during SSRF check - blocking request"
    );
    throw new Error(
      "Unable to resolve hostname. Please verify the URL is correct and the server is reachable."
    );
  }

  if (allAddresses.length === 0) {
    if (isDevelopment) {
      logger.debug(
        { url, hostname },
        "No DNS records found in development, allowing request"
      );
      return {
        originalUrl: url,
        resolvedUrl: url,
        resolvedIp: "no-records-dev",
        hostname,
      };
    }
    logger.error(
      { url, hostname },
      "No DNS records found - blocking request"
    );
    throw new Error(
      "Unable to resolve hostname. Please verify the URL is correct."
    );
  }

  if (!skipPrivateChecks) {
    const privateAddresses = allAddresses.filter(isPrivateOrLocalhostIP);
    if (privateAddresses.length > 0) {
      logger.warn(
        {
          url,
          hostname,
          resolvedAddresses: allAddresses,
          privateAddresses,
          reason: "resolves_to_private_ip",
        },
        "SSRF attempt blocked: hostname resolves to private IP"
      );
      throw new Error(
        "This hostname resolves to a private or localhost IP address, which is not allowed for security reasons"
      );
    }
  }

  // Use the first resolved IP for the actual request
  const resolvedIp = allAddresses[0]!;

  // Rewrite URL to use resolved IP
  const resolvedParsedUrl = new URL(url);
  // For IPv6, wrap in brackets
  resolvedParsedUrl.hostname = isIP(resolvedIp) === 6 ? `[${resolvedIp}]` : resolvedIp;
  const resolvedUrl = resolvedParsedUrl.toString();

  logger.debug(
    {
      url,
      hostname,
      resolvedIp,
      resolvedUrl,
    },
    "URL validated and resolved for SSRF-safe fetch"
  );

  return {
    originalUrl: url,
    resolvedUrl,
    resolvedIp,
    hostname,
  };
}

export interface SSRFSafeFetchOptions extends RequestInit {
  /** Use original URL for the request (for dev/allowlisted hosts) */
  useOriginalUrl?: boolean;
}

/**
 * Performs SSRF-validated fetch using the pre-resolved IP address.
 * Eliminates TOCTOU by using the resolved IP from validateUrlForSSRF.
 *
 * @param validated - Result from validateUrlForSSRF
 * @param init - Standard fetch options
 */
export async function fetchWithResolvedIp(
  validated: SSRFValidationResult,
  init?: SSRFSafeFetchOptions
): Promise<Response> {
  const headers = new Headers(init?.headers);

  // If we resolved to an IP, set Host header to original hostname
  // This is needed because we're connecting to the IP directly
  if (validated.resolvedUrl !== validated.originalUrl && !headers.has("Host")) {
    headers.set("Host", validated.hostname);
  }

  return fetch(validated.resolvedUrl, {
    ...init,
    headers,
  });
}

/**
 * Combined SSRF validation and fetch in a single atomic operation.
 * This is the recommended way to make SSRF-safe requests.
 *
 * @param url - URL to fetch
 * @param init - Standard fetch options
 * @throws Error if SSRF validation fails or DNS resolution fails in production
 */
export async function ssrfSafeFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const validated = await validateUrlForSSRF(url);
  return fetchWithResolvedIp(validated, init);
}
