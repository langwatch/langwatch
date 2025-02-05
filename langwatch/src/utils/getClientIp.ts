import type { NextApiRequest } from "next";

export function getClientIp(
  req: NextApiRequest | undefined
): string | undefined {
  if (!req) {
    return undefined;
  }

  // Array of possible IP headers, in order of preference
  const ipHeaders = [
    "cf-connecting-ip", // Cloudflare
    "x-forwarded-for", // AWS ELB and general proxy
    "x-forwarded", // AWS ELB
    "x-real-ip", // Nginx proxy
    "x-client-ip", // Apache
    "forwarded-for", // General forwarded header
    "forwarded", // General forwarded header
    "true-client-ip", // Akamai and Cloudflare
    "x-cluster-client-ip", // Rackspace LB, Riverbed Stingray
    "fastly-client-ip", // Fastly CDN
  ];

  // Function to clean and validate IP
  const cleanIp = (ip: string): string | null => {
    // Remove port if present and clean whitespace
    const cleanedIp =
      ip
        ?.split(",")[0]
        ?.replace(/^::ffff:/, "")
        .trim() ?? "";

    // Basic IP validation (both IPv4 and IPv6)
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

    if (ipv4Regex.test(cleanedIp) || ipv6Regex.test(cleanedIp)) {
      return cleanedIp;
    }
    return null;
  };

  // Check all headers
  for (const header of ipHeaders) {
    const value = req.headers[header];
    if (value) {
      if (Array.isArray(value)) {
        // If header has multiple values, take the first one
        const ip = cleanIp(value[0] ?? "");
        if (ip) return ip;
      } else {
        const ip = cleanIp(value);
        if (ip) return ip;
      }
    }
  }

  // Fallback to request socket
  if (req.socket && req.socket.remoteAddress) {
    const ip = cleanIp(req.socket.remoteAddress);
    if (ip) return ip;
  }

  return undefined;
}
