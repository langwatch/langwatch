import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { env } from "~/env.mjs";
import type { NextApiRequest } from "~/types/next-stubs";
import {
  getDirectPeerIp,
  getTrustedProxyClientIp,
  getTrustedProxyClientIpFromHonoContext,
  isPrivateAddress,
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
 * A proxy on a public address that the operator has not declared.
 *
 * WHY THIS IS WORTH A LOG LINE, AND WHY ONLY THIS SHAPE IS. An undeclared hop
 * on a private address needs no announcement: the resolver reads it as
 * infrastructure and recovers the real caller from the chain, which is the
 * right answer with nothing configured. A hop on a PUBLIC address is
 * indistinguishable from a caller, so the resolver reads it as one and the
 * chain it appended goes unread. Every visitor arriving through it then shares
 * that hop's budget - and these budgets are small on purpose (sixty routing
 * questions an hour, five reset requests), so shared they stop limiting an
 * attacker and start capping the installation.
 *
 * Nothing here can fix it. The only thing that separates a public hop from a
 * public caller is `TRUSTED_PROXY_ADDRESSES`, which is a fact only the operator
 * has. So this refuses to guess and refuses to fail: it watches for the one
 * combination that shows the mistake - a forwarding header arriving from a
 * public peer we vouch for nobody about - and says so once, naming the setting
 * that fixes it. Warning rather than refusing to boot, because a deployment
 * that is genuinely not behind a proxy is correct as it stands.
 */
function announceUndeclaredPublicProxyOnce(
  req: NextApiRequest | undefined,
): void {
  if (announcedUnconfiguredProxy) return;
  if (trustedProxyAddresses.length > 0) return;
  if (!req?.headers?.["x-forwarded-for"]) return;

  const peer = getDirectPeerIp(req);
  if (!peer || isPrivateAddress(peer)) return;

  announcedUnconfiguredProxy = true;
  logger.warn(
    { setting: "TRUSTED_PROXY_ADDRESSES" },
    "Ignored a forwarded-for header from a public peer, so signed-out authentication limits are counting that peer rather than the caller behind it. If it is this deployment's proxy, name it in TRUSTED_PROXY_ADDRESSES.",
  );
}

/**
 * The stable client identity used by signed-out authentication limits.
 *
 * Deployment configuration is parsed once here, at the auth composition
 * boundary. The resolver falls back to the socket peer unless that peer is one
 * of the deployment's own hops, so a forwarding header received directly from a
 * caller never becomes a rate-limit key.
 */
export function getAuthRateLimitClientIp(
  req: NextApiRequest | undefined,
): string | undefined {
  announceUndeclaredPublicProxyOnce(req);
  return getTrustedProxyClientIp(req, trustedProxyAddresses);
}

/**
 * The same identity, for the Hono request that reaches Better Auth.
 *
 * Better Auth runs its own limits over `/api/auth/*` and resolves the caller
 * from the request it is handed, so the two limiters agree only if they are
 * given the same answer. This is where the auth route gets it.
 */
export function getAuthRateLimitClientIpFromHonoContext(
  c: Context,
): string | undefined {
  return getTrustedProxyClientIpFromHonoContext(c, trustedProxyAddresses);
}
