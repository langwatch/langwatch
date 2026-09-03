import dns from "node:dns/promises";
import { isIP } from "node:net";
import { createLogger } from "@langwatch/observability";
import { classify as classifyEgressAddress } from "./address";
import { BLOCKED_CLOUD_DOMAINS, BLOCKED_METADATA_HOSTS } from "./blocked-hosts";

/**
 * Which addresses a process may open a connection to, and what it must connect
 * to once it has decided.
 *
 * FROZEN TWIN of the validation half of
 * `platform/app/src/utils/ssrfProtection.ts`. That module is the application's
 * and stays as it is while both graphs send; this one is what a package or a
 * background process composes. The two must answer the same question the same
 * way — an address one admits and the other refuses is a customer whose webhook
 * works from one pod and fails from the next.
 *
 * ## What is refused, always
 * - Cloud metadata endpoints (`BLOCKED_METADATA_HOSTS`)
 * - Cloud provider internal domains (`BLOCKED_CLOUD_DOMAINS`, suffix match)
 *
 * ## What is refused when `blockLocal` is set
 * Every non-globally-routable address, as classified by `./address` — one
 * table shared byte-for-byte with the Go services and held to one conformance
 * corpus. That is the whole IANA special-purpose registry, not just the classic
 * private ranges: loopback, RFC 1918, link-local, CGNAT, TEST-NET,
 * benchmarking, multicast and reserved on IPv4; `::1`, `::`, ULA, link-local,
 * NAT64, 6to4, Teredo and documentation on IPv6; IPv4-mapped IPv6 unmapped and
 * re-checked as IPv4; and any hostname that RESOLVES to one of those.
 *
 * ## Allowlist
 * `allowedHosts` is matched literally and case-insensitively against the URL
 * hostname. A match bypasses the local-address block and NEVER bypasses the
 * metadata refusal, which is already decided above it.
 *
 * ## DNS rebinding
 * The name is resolved once, here, and the resolved IP travels in the result so
 * the connection is pinned to the address that was actually judged. There is no
 * second lookup for an attacker to answer differently.
 *
 * Unlike the application's module this one reads no environment: the policy is
 * a parameter, because a package cannot know whose process it is composed in.
 */

const logger = createLogger("langwatch:ssrfProtection");

/** Which addresses this validator admits. Injected, never read from the environment. */
export interface SsrfPolicy {
  /** When true, refuse private / loopback / link-local, and hostnames resolving to them. Metadata is refused either way. */
  blockLocal: boolean;
  /** Literal hostname allowlist (case-insensitive) that bypasses the local-address block only. */
  allowedHosts: string[];
}

/**
 * A destination that passed the policy, and the address it was judged at.
 *
 * A discriminated union rather than an optional IP: "admitted but never
 * resolved" and "admitted at this exact address" are different facts, and a
 * caller that pins the connection needs to know which one it holds.
 */
export type SsrfValidationResult =
  | SsrfResolvedResult
  | SsrfAllowlistedResult
  | SsrfUnresolvedResult;

interface SsrfResultBase {
  originalUrl: string;
  hostname: string;
  port: number;
  protocol: string;
  path: string;
}

export interface SsrfResolvedResult extends SsrfResultBase {
  type: "resolved";
  resolvedIp: string;
}

export interface SsrfAllowlistedResult extends SsrfResultBase {
  type: "allowlisted";
  resolvedIp?: string;
}

export interface SsrfUnresolvedResult extends SsrfResultBase {
  type: "unresolved";
  reason: "dns-failed" | "no-records";
}

/** The validator a caller holds: one URL in, an admitted destination or a throw. */
export type SsrfUrlValidator = (url: string) => Promise<SsrfValidationResult>;

interface ValidationContext {
  url: string;
  parsedUrl: URL;
  hostname: string;
  port: number;
  path: string;
}

function isBareLocalhostOrLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "local";
}

/**
 * Whether the hostname matches a blocked cloud-provider domain suffix.
 *
 * Bare `localhost` and `local` are excluded on purpose: they are the
 * local-address policy's business, which an operator may relax, not this
 * unconditional one.
 */
export function isBlockedCloudDomain(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  if (isBareLocalhostOrLocal(lowerHostname)) {
    return false;
  }

  return BLOCKED_CLOUD_DOMAINS.some(
    (domain) => lowerHostname === domain.slice(1) || lowerHostname.endsWith(domain),
  );
}

/**
 * Whether an IP literal is non-globally-routable.
 *
 * Delegates to `./address` so this package, the application, the Go AI
 * gateway, the Go Langy egress proxy and the NLP service all agree on exactly
 * which addresses are unsafe to reach. A metadata address is non-global too, so
 * it is reported here as well as refused unconditionally above.
 */
export function isPrivateOrLocalhostIP(ip: string): boolean {
  return classifyEgressAddress(ip) !== "global";
}

function validateNotMetadataEndpoint(ctx: ValidationContext): void {
  if (BLOCKED_METADATA_HOSTS.some((host) => host === ctx.hostname)) {
    logger.error(
      { url: ctx.url, hostname: ctx.hostname, reason: "metadata_endpoint" },
      "SSRF attempt blocked: cloud metadata endpoint",
    );
    throw new Error("Access to cloud metadata endpoints is not allowed for security reasons");
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

function validateNotPrivateIpLiteral(ctx: ValidationContext, blockLocal: boolean): void {
  const ipVersion = isIP(ctx.hostname);
  if (ipVersion !== 0 && blockLocal && isPrivateOrLocalhostIP(ctx.hostname)) {
    logger.warn(
      { url: ctx.url, hostname: ctx.hostname, ipVersion, reason: "private_ip_literal" },
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
  blockLocal: boolean,
): void {
  if (!blockLocal) return;

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

async function resolveHostname(hostname: string): Promise<string[]> {
  const promises = [
    dns.resolve(hostname, "A").catch(() => [] as string[]),
    dns.resolve(hostname, "AAAA").catch(() => [] as string[]),
  ];

  const [ipv4Addresses = [], ipv6Addresses = []] = await Promise.all(promises);
  return [...ipv4Addresses, ...ipv6Addresses];
}

function buildResultBase(ctx: ValidationContext): SsrfResultBase {
  return {
    originalUrl: ctx.url,
    hostname: ctx.hostname,
    port: ctx.port,
    protocol: ctx.parsedUrl.protocol,
    path: ctx.path,
  };
}

function buildResolvedResult(ctx: ValidationContext, resolvedIp: string): SsrfResolvedResult {
  return { ...buildResultBase(ctx), type: "resolved", resolvedIp };
}

function buildAllowlistedResult(
  ctx: ValidationContext,
  resolvedIp?: string,
): SsrfAllowlistedResult {
  return { ...buildResultBase(ctx), type: "allowlisted", resolvedIp };
}

function buildUnresolvedResult(
  ctx: ValidationContext,
  reason: "dns-failed" | "no-records",
): SsrfUnresolvedResult {
  return { ...buildResultBase(ctx), type: "unresolved", reason };
}

/** Builds a validator for one address policy. */
export function createSsrfUrlValidator(policy: SsrfPolicy): SsrfUrlValidator {
  return async function validateUrlForSsrf(url: string): Promise<SsrfValidationResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("Invalid URL format");
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(
        `Unsupported protocol: ${parsedUrl.protocol} — only http and https are allowed`,
      );
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const port = parsedUrl.port
      ? parseInt(parsedUrl.port, 10)
      : parsedUrl.protocol === "https:"
        ? 443
        : 80;
    const path = parsedUrl.pathname + parsedUrl.search;

    const ctx: ValidationContext = { url, parsedUrl, hostname, port, path };

    // Always refused, before anything an operator can relax is consulted.
    validateNotMetadataEndpoint(ctx);
    validateNotBlockedCloudDomain(ctx);

    if (policy.allowedHosts.length > 0) {
      const normalizedAllowed = policy.allowedHosts.map((host) => host.trim().toLowerCase());
      if (normalizedAllowed.includes(hostname)) {
        logger.info(
          { url, hostname, allowedHosts: normalizedAllowed },
          "Allowing request to allowlisted host",
        );
        const allowlistedVersion = isIP(hostname);
        return buildAllowlistedResult(ctx, allowlistedVersion !== 0 ? hostname : undefined);
      }
    }

    const ipVersion = isIP(hostname);
    if (ipVersion !== 0) {
      validateNotPrivateIpLiteral(ctx, policy.blockLocal);
      return buildResolvedResult(ctx, hostname);
    }

    let allAddresses: string[];
    try {
      allAddresses = await resolveHostname(hostname);
    } catch (dnsError) {
      if (!policy.blockLocal) {
        logger.debug(
          {
            url,
            hostname,
            error: dnsError instanceof Error ? dnsError.message : String(dnsError),
          },
          "DNS resolution failed; not blocking because the policy allows local addresses",
        );
        return buildUnresolvedResult(ctx, "dns-failed");
      }
      logger.error(
        {
          url,
          hostname,
          error: dnsError instanceof Error ? dnsError.message : String(dnsError),
        },
        "DNS resolution failed during SSRF check - blocking request",
      );
      throw new Error(
        `Unable to resolve hostname "${hostname}". Please verify the URL is correct and the server is reachable.`,
      );
    }

    if (allAddresses.length === 0) {
      if (!policy.blockLocal) {
        logger.debug(
          { url, hostname },
          "No DNS records found; not blocking because the policy allows local addresses",
        );
        return buildUnresolvedResult(ctx, "no-records");
      }
      logger.error({ url, hostname }, "No DNS records found - blocking request");
      throw new Error(
        `Unable to resolve hostname "${hostname}". Please verify the URL is correct.`,
      );
    }

    validateResolvedAddresses(ctx, allAddresses, policy.blockLocal);

    const resolvedIp = allAddresses[0]!;
    logger.debug({ url, hostname, resolvedIp }, "URL validated and resolved for SSRF-safe fetch");

    return buildResolvedResult(ctx, resolvedIp);
  };
}
