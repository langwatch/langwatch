import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

import {
  Config,
  ConfigParseError,
  environmentBooleanSchema,
  type ProcessConfigOf,
} from "@langwatch/config";
import { Secret } from "@langwatch/secrets";
import { z } from "zod";

/** The previous release refused an instance admin key under 32 characters; blank is absent. */
const instanceAdminKey = {
  parse(value: string): string {
    if (value.length >= 32) return value;
    throw new ConfigParseError([
      "http.instanceAdmin ← LANGWATCH_INSTANCE_ADMIN_API_KEY: must be at least 32 characters",
    ]);
  },
};

export const apiOwner = {
  name: "http",
  config: Config.define((c) => ({
    trustedProxies: c.env(
      "TRUSTED_PROXY_ADDRESSES",
      z
        .string()
        .optional()
        .transform((value) => {
          if (value === undefined) return void 0;
          return value
            .split(",")
            .map((address) => address.trim())
            .filter(Boolean);
        })
        .superRefine((entries, context) => {
          const unreadable = (entries ?? []).filter((entry) => !isAddressOrRange(entry));
          if (unreadable.length === 0) return;
          context.addIssue({
            code: "custom",
            message: `not an IPv4/IPv6 address or CIDR range: ${unreadable.join(", ")}`,
          });
        }),
    ),
    // CF-Connecting-IP is forgeable by anyone reaching the origin directly: read only from a
    // trusted peer.
    trustCloudflare: c.env("TRUST_CLOUDFLARE_CLIENT_IP", environmentBooleanSchema.default(false)),
    bundleDirectory: c.env(
      "LANGWATCH_UI_DIST_DIR",
      z
        .string()
        .default(fileURLToPath(new URL("../../../../apps/ui/dist/client", import.meta.url))),
    ),
    assetBase: c.env("LANGWATCH_ASSET_BASE", z.string().optional()),
  })),
  secrets: {
    instanceAdmin: Secret.load("LANGWATCH_INSTANCE_ADMIN_API_KEY", {
      optional: true,
      schema: instanceAdminKey,
    }),
  },
} as const;
export type ApiHostConfig = ProcessConfigOf<readonly [typeof apiOwner]>["http"];

/** CF-Connecting-IP is honoured only from a declared peer, so the flag alone would do nothing. */
export function cloudflareTrustOf(
  config: Pick<ApiHostConfig, "trustedProxies" | "trustCloudflare">,
): boolean {
  if (!config.trustCloudflare) return false;
  if ((config.trustedProxies ?? []).length > 0) return true;
  throw new ConfigParseError([
    "http.trustCloudflare ← TRUST_CLOUDFLARE_CLIENT_IP: set TRUSTED_PROXY_ADDRESSES to the Cloudflare ranges it is read from",
  ]);
}

/** One address or CIDR range, as TRUSTED_PROXY_ADDRESSES names a hop; a hostname is neither. */
function isAddressOrRange(entry: string): boolean {
  const [network = "", prefix, extra] = entry.split("/");
  const family = isIP(network);
  if (family === 0 || extra !== void 0) return false;
  if (prefix === void 0) return true;

  const bits = Number(prefix);
  if (!/^\d+$/.test(prefix) || bits > (family === 6 ? 128 : 32)) return false;
  // An IPv4-mapped range is read as its IPv4 range, so an IPv6 range may not reach past the
  // mapped block into it: one that covers `::ffff:0:0/96` would trust every IPv4 peer.
  return family === 4 || bits >= MAPPED_PREFIX_BITS || !coversMappedBlock(network, bits);
}

/** `::ffff:` and the 32 bits of an IPv4 address: the IPv4 range's prefix plus 96. */
const MAPPED_PREFIX_BITS = 96;

/** The IPv4-mapped block's 96-bit prefix, as six 16-bit groups: `::ffff:0:0`. */
const MAPPED_GROUPS = [0, 0, 0, 0, 0, 0xffff] as const;

/** Whether the range `network/bits` contains the IPv4-mapped block, in any notation. */
function coversMappedBlock(network: string, bits: number): boolean {
  const groups = ipv6Groups(network);

  return MAPPED_GROUPS.every((mapped, index) => {
    const masked = Math.max(0, Math.min(16, bits - index * 16));
    const mask = masked === 0 ? 0 : (0xffff << (16 - masked)) & 0xffff;
    return ((groups[index] ?? 0) & mask) === (mapped & mask);
  });
}

/** An IPv6 address `isIP` accepted, as its eight 16-bit groups; a dotted IPv4 tail is two. */
function ipv6Groups(address: string): number[] {
  const [head = "", tail] = address.toLowerCase().split("::");
  const parse = (part: string): number[] =>
    part === ""
      ? []
      : part.split(":").flatMap((group) => {
          if (isIP(group) !== 4) return [parseInt(group, 16)];
          const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
          return [(a << 8) | b, (c << 8) | d];
        });
  const leading = parse(head);
  if (tail === void 0) return leading;
  const trailing = parse(tail);

  return [...leading, ...Array<number>(8 - leading.length - trailing.length).fill(0), ...trailing];
}
