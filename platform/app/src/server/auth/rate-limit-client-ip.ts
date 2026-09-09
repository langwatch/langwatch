import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import type { NextApiRequest } from "~/types/next-stubs";
import {
  getTrustedProxyClientIp,
  parseTrustedProxyAddresses,
} from "~/utils/getClientIp";

const logger = createLogger("langwatch:auth:rate-limit-client-ip");

const trustedProxyAddresses = parseTrustedProxyAddresses(
  env.TRUSTED_PROXY_ADDRESSES,
);

/**
 * Said once, not once per request: this is a deployment fact, and repeating it
 * on a hot path would bury the thing it is trying to point at.
 */
let announcedUnconfiguredProxy = false;

/**
 * A deployment that is behind a proxy and has not said so.
 *
 * WHY THIS IS WORTH A LOG LINE. The socket peer is the right key when the
 * caller is the client. Behind a load balancer it is the BALANCER, so every
 * signed-out person on the deployment shares one bucket — and the budgets
 * these keys carry are small on purpose (sixty routing questions an hour,
 * five reset requests). Shared, they stop being a limit on an attacker and
 * become a cap on the whole installation: one script exhausts the hour for
 * everybody, which reads as "sign-in is down" and is invisible in the code.
 *
 * Nothing here can fix it. Naming the address alongside the peer would not:
 * the peer is still shared, so the shared budget still binds. The only thing
 * that recovers the real client is `TRUSTED_PROXY_ADDRESSES`, which is a fact
 * only the operator has.
 *
 * So this refuses to guess and refuses to fail. It watches for the one
 * combination that proves the mistake — a forwarding header arriving while we
 * vouch for nobody — and says so once, with the name of the setting that
 * fixes it. Warning rather than refusing to boot, because an installation
 * that is genuinely not behind a proxy is correct as it stands, and a hard
 * failure would strand every deployment that has been fine for years.
 */
function announceUnconfiguredProxyOnce(
  req: NextApiRequest | undefined,
): void {
  if (announcedUnconfiguredProxy) return;
  if (trustedProxyAddresses.length > 0) return;
  if (!req?.headers?.["x-forwarded-for"]) return;

  announcedUnconfiguredProxy = true;
  logger.warn(
    { setting: "TRUSTED_PROXY_ADDRESSES" },
    "Signed-out authentication limits are counting the proxy rather than the caller: a forwarded-for header arrived but no trusted proxy is configured, so every signed-out visitor shares one budget. Set TRUSTED_PROXY_ADDRESSES to this deployment's proxy addresses.",
  );
}

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
  announceUnconfiguredProxyOnce(req);
  return getTrustedProxyClientIp(req, trustedProxyAddresses);
}
