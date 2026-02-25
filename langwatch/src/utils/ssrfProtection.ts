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
 * ## On-Prem Mode (IS_SAAS=false)
 * - Private IP/hostname checks are skipped (allows reaching internal services)
 * - TLS certificate validation is disabled (allows self-signed certs)
 * - Cloud metadata endpoints and cloud provider domains are ALWAYS blocked
 *
 * ## Environment Variables
 * - IS_SAAS: "true"/"1" to enable SaaS mode, "false"/"0" or unset for on-prem mode
 * - ALLOWED_PROXY_HOSTS: Comma-separated allowlist for dev (e.g., "localhost,127.0.0.1")
 * - NODE_ENV: "development" or "production"
 *
 * @module ssrfProtection
 */

import dns from "dns/promises";
import { isIP } from "net";
import {
  Agent,
  type Response as FetchResponse,
  fetch as undiciFetch,
} from "undici";
import { env } from "../env.mjs";
import { createLogger } from "./logger";
import { BLOCKED_CLOUD_DOMAINS, BLOCKED_METADATA_HOSTS } from "./ssrfConstants";

const logger = createLogger("langwatch:ssrfProtection");

/** Single source of truth for SaaS mode. Uses env module (false when IS_SAAS is unset). */
const isSaaS = !!env.IS_SAAS;

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for SSRF validation behavior.
 * Inject this to avoid direct process.env dependency.
 */
export interface SSRFConfig {
  isDevelopment: boolean;
  allowedDevHosts: string[];
  /** When false (on-prem), private IP/hostname checks are skipped. Cloud metadata is always blocked. Defaults to true. */
  isSaaS: boolean;
}

/**
 * Discriminated union for SSRF validation results.
 * Makes illegal states unrepresentable.
 */
export type SSRFValidationResult =
  | SSRFResolvedResult
  | SSRFAllowlistedResult
  | SSRFDevelopmentBypassResult;

interface SSRFResultBase {
  originalUrl: string;
  hostname: string;
  port: number;
  protocol: string;
  path: string;
}

export interface SSRFResolvedResult extends SSRFResultBase {
  type: "resolved";
  resolvedIp: string;
}

export interface SSRFAllowlistedResult extends SSRFResultBase {
  type: "allowlisted";
  resolvedIp?: string;
}

export interface SSRFDevelopmentBypassResult extends SSRFResultBase {
  type: "development-bypass";
  reason: "dns-failed" | "no-records";
}

/**
 * Internal context passed between validators.
 */
interface ValidationContext {
  url: string;
  parsedUrl: URL;
  hostname: string;
  port: number;
  path: string;
  config: SSRFConfig;
}

// ============================================================================
// Error Message Formatters (Map-based, OCP-compliant)
// ============================================================================

type ErrorFormatter = (
  hostname: string,
  port: number,
  message: string,
) => string;

const CONNECTION_ERROR_FORMATTERS: Record<string, ErrorFormatter> = {
  ECONNREFUSED: (h, p) =>
    `Connection refused - is the server running at ${h}:${p}?`,
  ENOTFOUND: (h) => `Could not resolve hostname: ${h}`,
  ETIMEDOUT: (h, p) => `Connection timed out while connecting to ${h}:${p}`,
  ECONNRESET: (h, p) => `Connection was reset by ${h}:${p}`,
  CERT_HAS_EXPIRED: (h, _p, m) => `TLS certificate error for ${h}: ${m}`,
  DEPTH_ZERO_SELF_SIGNED_CERT: (h, _p, m) =>
    `TLS certificate error for ${h}: ${m}`,
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: (h, _p, m) =>
    `TLS certificate error for ${h}: ${m}`,
};

function formatConnectionError(
  err: Error,
  hostname: string,
  port: number,
): Error {
  const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
  const formatter = CONNECTION_ERROR_FORMATTERS[code];
  const message = formatter
    ? formatter(hostname, port, err.message)
    : `Connection failed to ${hostname}:${port}: ${err.message}`;
  return new Error(message);
}

// ============================================================================
// Domain Validation
// ============================================================================

function isBareLocalhostOrLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "local";
}

/**
 * Checks if hostname matches a blocked cloud provider domain pattern.
 * Bare "localhost" and "local" are NOT blocked here - they are handled
 * by the private IP checks which respect development mode settings.
 */
export function isBlockedCloudDomain(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  if (isBareLocalhostOrLocal(lowerHostname)) {
    return false;
  }

  return BLOCKED_CLOUD_DOMAINS.some(
    (domain) =>
      lowerHostname === domain.slice(1) || lowerHostname.endsWith(domain),
  );
}

// ============================================================================
// IP Address Validation
// ============================================================================

function isPrivateIPv4(ip: string): boolean {
  if (ip.startsWith("127.")) return true;
  if (ip === "0.0.0.0") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;

  const match172 = ip.match(/^172\.(\d+)\./);
  if (match172?.[1]) {
    const second = parseInt(match172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  if (ip.startsWith("169.254.")) return true;

  return false;
}

export function isPrivateOrLocalhostIP(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === "::1") return true;
  if (normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;

  const ipv4MappedMatch = normalized.match(/^::ffff:(.+)$/);
  if (ipv4MappedMatch?.[1]) {
    const mapped = ipv4MappedMatch[1];

    if (mapped.includes(".")) {
      return isPrivateIPv4(mapped);
    }

    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch?.[1] && hexMatch[2]) {
      const high = parseInt(hexMatch[1], 16);
      const low = parseInt(hexMatch[2], 16);
      const reconstructed = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
      return isPrivateIPv4(reconstructed);
    }
  }

  return isPrivateIPv4(ip);
}

// ============================================================================
// Focused Validators (SRP-compliant)
// ============================================================================

function validateNotMetadataEndpoint(ctx: ValidationContext): void {
  if (BLOCKED_METADATA_HOSTS.includes(ctx.hostname)) {
    logger.error(
      { url: ctx.url, hostname: ctx.hostname, reason: "metadata_endpoint" },
      "SSRF attempt blocked: cloud metadata endpoint",
    );
    throw new Error(
      "Access to cloud metadata endpoints is not allowed for security reasons",
    );
  }
}

function validateNotBlockedCloudDomain(ctx: ValidationContext): void {
  if (isBlockedCloudDomain(ctx.hostname)) {
    logger.error(
      { url: ctx.url, hostname: ctx.hostname, reason: "cloud_internal_domain" },
      "SSRF attempt blocked: cloud provider internal domain",
    );
    throw new Error(
      "Access to cloud provider internal domains is not allowed for security reasons",
    );
  }
}

function validateNotPrivateIpLiteral(
  ctx: ValidationContext,
  skipPrivateChecks: boolean,
): void {
  const ipVersion = isIP(ctx.hostname);
  if (
    ipVersion !== 0 &&
    !skipPrivateChecks &&
    isPrivateOrLocalhostIP(ctx.hostname)
  ) {
    logger.warn(
      {
        url: ctx.url,
        hostname: ctx.hostname,
        ipVersion,
        reason: "private_ip_literal",
      },
      "SSRF attempt blocked: private or localhost IP address",
    );
    throw new Error(
      "Access to private or localhost IP addresses is not allowed for security reasons",
    );
  }
}

function validateResolvedAddresses(
  ctx: ValidationContext,
  addresses: string[],
  skipPrivateChecks: boolean,
): void {
  if (skipPrivateChecks) return;

  const privateAddresses = addresses.filter(isPrivateOrLocalhostIP);
  if (privateAddresses.length > 0) {
    logger.warn(
      {
        url: ctx.url,
        hostname: ctx.hostname,
        resolvedAddresses: addresses,
        privateAddresses,
        reason: "resolves_to_private_ip",
      },
      "SSRF attempt blocked: hostname resolves to private IP",
    );
    throw new Error(
      "This hostname resolves to a private or localhost IP address, which is not allowed for security reasons",
    );
  }
}

// ============================================================================
// DNS Resolution
// ============================================================================

async function resolveHostname(hostname: string): Promise<string[]> {
  const promises = [
    dns.resolve(hostname, "A").catch(() => [] as string[]),
    dns.resolve(hostname, "AAAA").catch(() => [] as string[]),
  ];

  const [ipv4Addresses = [], ipv6Addresses = []] = await Promise.all(promises);
  return [...ipv4Addresses, ...ipv6Addresses];
}

// ============================================================================
// Result Builders
// ============================================================================

function buildResultBase(ctx: ValidationContext): SSRFResultBase {
  return {
    originalUrl: ctx.url,
    hostname: ctx.hostname,
    port: ctx.port,
    protocol: ctx.parsedUrl.protocol,
    path: ctx.path,
  };
}

function buildResolvedResult(
  ctx: ValidationContext,
  resolvedIp: string,
): SSRFResolvedResult {
  return { ...buildResultBase(ctx), type: "resolved", resolvedIp };
}

function buildAllowlistedResult(
  ctx: ValidationContext,
  resolvedIp?: string,
): SSRFAllowlistedResult {
  return { ...buildResultBase(ctx), type: "allowlisted", resolvedIp };
}

function buildDevelopmentBypassResult(
  ctx: ValidationContext,
  reason: "dns-failed" | "no-records",
): SSRFDevelopmentBypassResult {
  return { ...buildResultBase(ctx), type: "development-bypass", reason };
}

// ============================================================================
// Main Validation Logic
// ============================================================================

/**
 * Creates an SSRF validator with injected configuration.
 * Use this for testability or custom configurations.
 */
export function createSSRFValidator(config: SSRFConfig) {
  return async function validateUrlForSSRF(
    url: string,
  ): Promise<SSRFValidationResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("Invalid URL format");
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const port = parsedUrl.port
      ? parseInt(parsedUrl.port, 10)
      : parsedUrl.protocol === "https:"
        ? 443
        : 80;
    const path = parsedUrl.pathname + parsedUrl.search;

    const ctx: ValidationContext = {
      url,
      parsedUrl,
      hostname,
      port,
      path,
      config,
    };

    // Always validate metadata and cloud domains (critical security)
    validateNotMetadataEndpoint(ctx);
    validateNotBlockedCloudDomain(ctx);

    // Check development allowlist
    if (config.isDevelopment && config.allowedDevHosts.length > 0) {
      const normalizedAllowed = config.allowedDevHosts.map((h) =>
        h.trim().toLowerCase(),
      );
      if (normalizedAllowed.includes(hostname)) {
        logger.info(
          { url, hostname, allowedHosts: normalizedAllowed },
          "Development mode: allowing request to allowlisted host",
        );
        const ipVersion = isIP(hostname);
        return buildAllowlistedResult(
          ctx,
          ipVersion !== 0 ? hostname : undefined,
        );
      }
    }

    const skipPrivateChecks =
      !config.isSaaS ||
      (config.isDevelopment && config.allowedDevHosts.length === 0);

    // Handle IP literals
    const ipVersion = isIP(hostname);
    if (ipVersion !== 0) {
      validateNotPrivateIpLiteral(ctx, skipPrivateChecks);
      return buildResolvedResult(ctx, hostname);
    }

    // Resolve hostname to IP addresses
    let allAddresses: string[];
    try {
      allAddresses = await resolveHostname(hostname);
    } catch (dnsError) {
      if (config.isDevelopment) {
        logger.debug(
          {
            url,
            hostname,
            error:
              dnsError instanceof Error ? dnsError.message : String(dnsError),
          },
          "DNS resolution failed during SSRF check in development",
        );
        return buildDevelopmentBypassResult(ctx, "dns-failed");
      }
      logger.error(
        {
          url,
          hostname,
          error:
            dnsError instanceof Error ? dnsError.message : String(dnsError),
        },
        "DNS resolution failed during SSRF check - blocking request",
      );
      throw new Error(
        "Unable to resolve hostname. Please verify the URL is correct and the server is reachable.",
      );
    }

    if (allAddresses.length === 0) {
      if (config.isDevelopment) {
        logger.debug(
          { url, hostname },
          "No DNS records found in development, allowing request",
        );
        return buildDevelopmentBypassResult(ctx, "no-records");
      }
      logger.error(
        { url, hostname },
        "No DNS records found - blocking request",
      );
      throw new Error(
        "Unable to resolve hostname. Please verify the URL is correct.",
      );
    }

    validateResolvedAddresses(ctx, allAddresses, skipPrivateChecks);

    const resolvedIp = allAddresses[0]!;
    logger.debug(
      { url, hostname, resolvedIp },
      "URL validated and resolved for SSRF-safe fetch",
    );

    return buildResolvedResult(ctx, resolvedIp);
  };
}

/**
 * Default validator using environment variables.
 * For most use cases, use this or ssrfSafeFetch directly.
 */
export const validateUrlForSSRF = createSSRFValidator({
  isDevelopment: process.env.NODE_ENV === "development",
  allowedDevHosts: process.env.ALLOWED_PROXY_HOSTS?.split(",") || [],
  isSaaS,
});

// ============================================================================
// Fetch Implementation
// ============================================================================

const MAX_REDIRECTS = 10;

export interface SSRFSafeFetchOptions extends RequestInit {
  _redirectCount?: number;
}

/** Returns TLS/fetch configuration based on SaaS mode. */
export function createSSRFSafeFetchConfig({ isSaaS }: { isSaaS: boolean }): { rejectUnauthorized: boolean } {
  return { rejectUnauthorized: isSaaS };
}

const defaultFetchConfig = createSSRFSafeFetchConfig({ isSaaS });

function createIpPinningAgent(resolvedIp: string, tlsConfig: { rejectUnauthorized: boolean } = defaultFetchConfig): Agent {
  return new Agent({
    connect: {
      rejectUnauthorized: tlsConfig.rejectUnauthorized,
      lookup: (_hostname, _options, callback) => {
        callback(null, [
          { address: resolvedIp, family: isIP(resolvedIp) === 6 ? 6 : 4 },
        ]);
      },
    },
  });
}

function getResolvedIpForPinning(result: SSRFValidationResult): string | null {
  switch (result.type) {
    case "resolved":
      return result.resolvedIp;
    case "allowlisted":
      return result.resolvedIp ?? null;
    case "development-bypass":
      return null;
  }
}

/**
 * Performs SSRF-validated fetch using the pre-resolved IP address.
 * Eliminates TOCTOU by using undici's dispatcher to pin to the resolved IP.
 * Uses redirect: 'manual' to validate redirect URLs before following.
 *
 * @param validated - The validated SSRF result from createSSRFValidator
 * @param init - Fetch options, including optional _redirectCount
 * @param tlsConfig - Optional TLS config override for testing. Defaults to module-level config.
 */
export async function fetchWithResolvedIp(
  validated: SSRFValidationResult,
  init?: SSRFSafeFetchOptions,
  tlsConfig: { rejectUnauthorized: boolean } = defaultFetchConfig,
): Promise<FetchResponse> {
  const headers = new Headers(init?.headers);
  const redirectCount = init?._redirectCount ?? 0;

  if (!headers.has("Host")) {
    headers.set("Host", validated.hostname);
  }

  const requestUrl = `${validated.protocol}//${validated.hostname}:${validated.port}${validated.path}`;
  const resolvedIp = getResolvedIpForPinning(validated);

  // Use IP pinning dispatcher when we have a resolved IP.
  // Always apply TLS config (e.g. rejectUnauthorized) via a custom Agent.
  const dispatcher =
    resolvedIp && isIP(resolvedIp) !== 0
      ? createIpPinningAgent(resolvedIp, tlsConfig)
      : new Agent({ connect: { rejectUnauthorized: tlsConfig.rejectUnauthorized } });

  try {
    const response = await undiciFetch(requestUrl, {
      method: init?.method,
      headers,
      body: init?.body as string | undefined,
      redirect: "manual",
      dispatcher,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        if (redirectCount >= MAX_REDIRECTS) {
          throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
        }

        const redirectUrl = new URL(location, validated.originalUrl).toString();

        logger.debug(
          {
            originalUrl: validated.originalUrl,
            redirectUrl,
            redirectCount: redirectCount + 1,
          },
          "Following redirect with SSRF validation",
        );

        const redirectValidated = await validateUrlForSSRF(redirectUrl);

        const redirectInit: SSRFSafeFetchOptions = {
          ...init,
          _redirectCount: redirectCount + 1,
        };

        if (
          response.status === 303 ||
          (response.status !== 307 &&
            response.status !== 308 &&
            init?.method === "POST")
        ) {
          redirectInit.method = "GET";
          redirectInit.body = undefined;
        }

        return fetchWithResolvedIp(redirectValidated, redirectInit, tlsConfig);
      }
    }

    return response;
  } catch (err) {
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
 */
export async function ssrfSafeFetch(
  url: string,
  init?: RequestInit,
): Promise<FetchResponse> {
  const validated = await validateUrlForSSRF(url);
  return fetchWithResolvedIp(validated, init);
}
