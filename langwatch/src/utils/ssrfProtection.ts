import dns from "dns/promises";
import { isIP } from "net";
import { createLogger } from "./logger";

const logger = createLogger("langwatch:ssrfProtection");

/**
 * Checks if an IP address is private, localhost, or link-local
 */
export function isPrivateOrLocalhostIP(ip: string): boolean {
  // Loopback (127.0.0.0/8, ::1)
  if (ip.startsWith("127.") || ip === "::1" || ip === "0.0.0.0") return true;

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

  // Link-local (169.254.0.0/16, fe80::/10)
  if (ip.startsWith("169.254.")) return true;
  if (ip.toLowerCase().startsWith("fe80:")) return true;

  return false;
}

/**
 * Validates URL for SSRF protection
 * Blocks requests to:
 * - Cloud metadata endpoints (always, even in dev)
 * - Private/localhost IPs (production only, unless in allowlist for dev)
 * - Hostnames that resolve to private IPs
 *
 * @throws Error with user-friendly message if validation fails
 */
export async function validateUrlForSSRF(url: string): Promise<void> {
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

  // In development, check if host is in allowlist
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
      return; // Skip further checks for allowlisted dev hosts
    }
  }

  // Skip localhost/private IP checks in development (unless we have an allowlist)
  const skipPrivateChecks = isDevelopment && allowedDevHosts.length === 0;

  if (!skipPrivateChecks) {
    // Check if hostname is a literal IP address
    const ipVersion = isIP(hostname);
    if (ipVersion !== 0) {
      if (isPrivateOrLocalhostIP(hostname)) {
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
    } else {
      // Resolve hostname to IP addresses and check all results
      try {
        // Check both A (IPv4) and AAAA (IPv6) records
        const promises = [
          dns.resolve(hostname, "A").catch(() => [] as string[]),
          dns.resolve(hostname, "AAAA").catch(() => [] as string[]),
        ];

        const [ipv4Addresses = [], ipv6Addresses = []] = await Promise.all(promises);
        const allAddresses = [...ipv4Addresses, ...ipv6Addresses];

        if (allAddresses.length > 0) {
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
      } catch (dnsError) {
        // DNS resolution failed - let fetch handle the actual network error
        // This could be a legitimate network issue or non-existent domain
        logger.debug(
          {
            url,
            hostname,
            error: dnsError instanceof Error ? dnsError.message : String(dnsError),
          },
          "DNS resolution failed during SSRF check, allowing request to proceed"
        );
      }
    }
  }
}
