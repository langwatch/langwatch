import { env } from "~/env.mjs";
import type { NextApiRequest } from "~/types/next-stubs";
import {
  getTrustedProxyClientIp,
  parseTrustedProxyAddresses,
} from "~/utils/getClientIp";

const trustedProxyAddresses = parseTrustedProxyAddresses(
  env.TRUSTED_PROXY_ADDRESSES,
);

/**
 * The stable client identity used by signed-out authentication limits.
 *
 * Deployment configuration is parsed once here, at the auth composition
 * boundary. The resolver falls back to the socket peer unless that peer is in
 * the allow-list, so forwarding headers received directly from a caller never
 * become rate-limit keys.
 */
export function getAuthRateLimitClientIp(
  req: NextApiRequest | undefined,
): string | undefined {
  return getTrustedProxyClientIp(req, trustedProxyAddresses);
}
