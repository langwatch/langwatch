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
  return /^\d+$/.test(prefix) && bits <= (family === 6 ? 128 : 32);
}
