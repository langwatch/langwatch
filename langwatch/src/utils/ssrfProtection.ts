/**
 * SSRF Protection Module
 *
 * Prevents Server-Side Request Forgery by validating URLs before fetching.
 *
 * ## What's Blocked (Always)
 * - Cloud metadata endpoints (see ssrfConstants.ts for full list)
 * - Cloud provider internal domains (configured for AWS, see ssrfConstants.ts to extend)
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
 * 3. Using custom HTTP/HTTPS agents to connect to the resolved IP
 * 4. Setting proper Host header and TLS servername for correct routing
 *
 * ## Redirect Protection
 * HTTP redirects are validated before following:
 * - Uses redirect: 'manual' to intercept redirects
 * - Re-validates redirect URLs through SSRF checks
 * - Limits redirect chain to 10 hops to prevent infinite loops
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
import { Agent, fetch as undiciFetch } from "undici";
import { createLogger } from "./logger";
import { BLOCKED_CLOUD_DOMAINS, BLOCKED_METADATA_HOSTS } from "./ssrfConstants";

const logger = createLogger("langwatch:ssrfProtection");

export interface SSRFValidationResult {
  /** Original URL for logging/display */
  originalUrl: string;
  /** The resolved IP address */
  resolvedIp: string;
  /** Original hostname (needed for Host header and TLS SNI) */
  hostname: string;
  /** Port number (defaults to 80 for HTTP, 443 for HTTPS) */
  port: number;
  /** Protocol (http: or https:) */
  protocol: string;
  /** Path including query string */
  path: string;
}


/**
 * Checks if hostname matches a blocked cloud provider domain pattern.
 * Note: bare "localhost" and "local" are NOT blocked here - they are handled
 * by the private IP checks which respect development mode settings.
 */
export function isBlockedCloudDomain(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  // Don't block bare "localhost" or "local" - these are handled by private IP checks
  // which properly respect development mode. We only want to block subdomains like
  // "app.localhost" or "service.local" as cloud-internal domains.
  if (lowerHostname === "localhost" || lowerHostname === "local") {
    return false;
  }

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
  if (BLOCKED_METADATA_HOSTS.includes(hostname)) {
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

  // Extract port and path for later use
  const port = parsedUrl.port
    ? parseInt(parsedUrl.port, 10)
    : (parsedUrl.protocol === "https:" ? 443 : 80);
  const path = parsedUrl.pathname + parsedUrl.search;

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
        resolvedIp: ipVersion !== 0 ? hostname : "allowlisted",
        hostname,
        port,
        protocol: parsedUrl.protocol,
        path,
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
      resolvedIp: hostname,
      hostname,
      port,
      protocol: parsedUrl.protocol,
      path,
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
        resolvedIp: "unresolved-dev",
        hostname,
        port,
        protocol: parsedUrl.protocol,
        path,
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
        resolvedIp: "no-records-dev",
        hostname,
        port,
        protocol: parsedUrl.protocol,
        path,
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

  logger.debug(
    {
      url,
      hostname,
      resolvedIp,
    },
    "URL validated and resolved for SSRF-safe fetch"
  );

  return {
    originalUrl: url,
    resolvedIp,
    hostname,
    port,
    protocol: parsedUrl.protocol,
    path,
  };
}

/** Maximum number of redirects to follow */
const MAX_REDIRECTS = 10;

export interface SSRFSafeFetchOptions extends RequestInit {
  /** Internal: current redirect count (do not set manually) */
  _redirectCount?: number;
}

/**
 * Converts a low-level network error to a user-friendly message.
 */
function formatConnectionError(err: Error, hostname: string, port: number): Error {
  const code = (err as NodeJS.ErrnoException).code;

  switch (code) {
    case "ECONNREFUSED":
      return new Error(`Connection refused - is the server running at ${hostname}:${port}?`);
    case "ENOTFOUND":
      return new Error(`Could not resolve hostname: ${hostname}`);
    case "ETIMEDOUT":
      return new Error(`Connection timed out while connecting to ${hostname}:${port}`);
    case "ECONNRESET":
      return new Error(`Connection was reset by ${hostname}:${port}`);
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return new Error(`TLS certificate error for ${hostname}: ${err.message}`);
    default:
      // Include original message for unknown errors
      return new Error(`Connection failed to ${hostname}:${port}: ${err.message}`);
  }
}

/**
 * Creates an undici Agent that pins to the resolved IP address.
 * This prevents DNS rebinding attacks by using custom DNS lookup.
 */
function createIpPinningAgent(resolvedIp: string): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        // Return the pre-resolved IP to prevent DNS rebinding
        callback(null, [{ address: resolvedIp, family: isIP(resolvedIp) === 6 ? 6 : 4 }]);
      },
    },
  });
}

/**
 * Performs SSRF-validated fetch using the pre-resolved IP address.
 * Eliminates TOCTOU by using undici's dispatcher to pin to the resolved IP.
 * Uses redirect: 'manual' to validate redirect URLs before following.
 *
 * @param validated - Result from validateUrlForSSRF
 * @param init - Standard fetch options
 */
export async function fetchWithResolvedIp(
  validated: SSRFValidationResult,
  init?: SSRFSafeFetchOptions
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const redirectCount = init?._redirectCount ?? 0;

  // Set Host header to original hostname for proper virtual host routing
  if (!headers.has("Host")) {
    headers.set("Host", validated.hostname);
  }

  const requestUrl = `${validated.protocol}//${validated.hostname}:${validated.port}${validated.path}`;

  // Determine if we need IP pinning (when we have a real resolved IP)
  const needsIpPinning = isIP(validated.resolvedIp) !== 0;

  try {
    let response: Response;

    if (needsIpPinning) {
      // Use undici with custom dispatcher for IP pinning
      const dispatcher = createIpPinningAgent(validated.resolvedIp);
      response = await undiciFetch(requestUrl, {
        ...init,
        headers,
        redirect: "manual",
        dispatcher,
      });
    } else {
      // Development mode with unresolved IPs - use regular fetch
      response = await fetch(requestUrl, {
        ...init,
        headers,
        redirect: "manual",
      });
    }

    // Handle redirects manually to validate redirect URLs
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        if (redirectCount >= MAX_REDIRECTS) {
          throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
        }

        // Resolve relative redirects against original URL
        const redirectUrl = new URL(location, validated.originalUrl).toString();

        logger.debug(
          {
            originalUrl: validated.originalUrl,
            redirectUrl,
            redirectCount: redirectCount + 1,
          },
          "Following redirect with SSRF validation"
        );

        // Validate the redirect URL through SSRF checks
        const redirectValidated = await validateUrlForSSRF(redirectUrl);

        // Follow redirect with GET method (standard behavior for 301/302/303)
        const redirectInit: SSRFSafeFetchOptions = {
          ...init,
          _redirectCount: redirectCount + 1,
        };

        // Convert to GET for 303 or POST redirects (standard HTTP behavior)
        if (response.status === 303 || (response.status !== 307 && response.status !== 308 && init?.method === "POST")) {
          redirectInit.method = "GET";
          redirectInit.body = undefined;
        }

        return fetchWithResolvedIp(redirectValidated, redirectInit);
      }
    }

    return response;
  } catch (err) {
    // Wrap fetch errors with more context
    if (err instanceof Error) {
      const cause = (err as Error & { cause?: Error }).cause;
      if (cause) {
        throw formatConnectionError(cause, validated.hostname, validated.port);
      }
      throw formatConnectionError(err, validated.hostname, validated.port);
    }
    throw err;
  }
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
