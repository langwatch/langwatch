import { isIP } from "node:net";

import { BLOCKED_METADATA_HOSTS, isCloudMetadataHost } from "@langwatch/egress";
import { PrivateModelEndpointInvalidError } from "@langwatch/model-provider-contract";

/**
 * What a private endpoint and a binding may hold (ADR-203). Staff register exact private
 * addresses; an organization names hostnames. Each refusal names its field and says why.
 */

const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_ADDRESSES = 16;

function refuse(
  field: "hostname" | "addresses" | "port" | "name" | "region",
  reason: string,
): never {
  throw new PrivateModelEndpointInvalidError({ field, reason });
}

/** RFC 1918: 10/8, 172.16/12 and 192.168/16, where a PrivateLink interface address lives. */
function isPrivateIpv4(address: string): boolean {
  const [first = -1, second = -1] = address.split(".").map(Number);
  if (first === 10) return true;
  if (first === 172) return second >= 16 && second <= 31;
  return first === 192 && second === 168;
}

/** IPv6 unique-local, fc00::/7: the first hextet's top seven bits are 1111110. */
function isPrivateIpv6(address: string): boolean {
  if (address.startsWith(":")) return false;
  const firstHextet = Number.parseInt(address.split(":")[0] ?? "", 16);
  return (firstHextet & 0xfe_00) === 0xfc_00;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  return isPrivateIpv6(address);
}

function isHostnameLabel(label: string): boolean {
  return HOSTNAME_LABEL.test(label);
}

/** Refuses a hostname a binding may not name, saying why. */
function assertBindableHostname(hostname: string): void {
  if (hostname === "") refuse("hostname", "Enter a hostname.");
  if (hostname.startsWith("[") || isIP(hostname) !== 0) {
    refuse("hostname", "Enter a hostname, not an IP address.");
  }
  if (hostname.includes("*")) {
    refuse("hostname", "Wildcards are not supported; bind each hostname.");
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    refuse("hostname", "localhost cannot be bound.");
  }
  if (!hostname.includes(".")) {
    refuse("hostname", "Enter a fully qualified hostname, such as llm.example.com.");
  }
  if (hostname.length > MAX_HOSTNAME_LENGTH || !hostname.split(".").every(isHostnameLabel)) {
    refuse("hostname", "Enter a valid hostname: letters, digits, hyphens and dots only.");
  }
  if (isCloudMetadataHost(hostname)) {
    refuse("hostname", "A cloud metadata hostname cannot be bound.");
  }
}

/** The hostname as it is stored and matched: trimmed, lowercased, no trailing dot. */
export function normalizeBindingHostname(input: string): string {
  const hostname = input.trim().toLowerCase().replace(/\.$/, "");
  assertBindableHostname(hostname);
  return hostname;
}

function isMetadataAddress(address: string): boolean {
  return (
    (BLOCKED_METADATA_HOSTS as readonly string[]).includes(address) || isCloudMetadataHost(address)
  );
}

/** Refuses one address staff may not register, saying why. */
function assertRegistrableAddress(address: string): void {
  if (address.includes("/")) {
    refuse("addresses", `${address} is a range; enter single addresses.`);
  }
  if (isIP(address) === 0) refuse("addresses", `${address} is not an IP address.`);
  if (isMetadataAddress(address)) {
    refuse("addresses", `${address} is a cloud metadata address.`);
  }
  if (!isPrivateAddress(address)) {
    refuse(
      "addresses",
      `${address} is not a private address (10/8, 172.16/12, 192.168/16 or fc00::/7).`,
    );
  }
}

/** The registered addresses: each a single private address, never public, loopback or metadata. */
export function normalizeEndpointAddresses(input: readonly string[]): string[] {
  const addresses = [...new Set(input.map((address) => address.trim().toLowerCase()))].filter(
    (address) => address !== "",
  );
  if (addresses.length === 0) refuse("addresses", "Enter at least one address.");
  if (addresses.length > MAX_ADDRESSES) {
    refuse("addresses", `Enter at most ${MAX_ADDRESSES} addresses.`);
  }
  for (const address of addresses) assertRegistrableAddress(address);
  return addresses;
}

/** The one TCP port the endpoint serves. */
export function validateEndpointPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    refuse("port", "The port must be a whole number from 1 to 65535.");
  }
  return port;
}

/** A display field staff fill in: trimmed, required, bounded. */
export function normalizeEndpointLabel({
  field,
  value,
}: {
  field: "name" | "region";
  value: string;
}): string {
  const trimmed = value.trim();
  if (trimmed === "") refuse(field, `Enter a ${field}.`);
  if (trimmed.length > 120) refuse(field, `The ${field} must be at most 120 characters.`);
  return trimmed;
}
