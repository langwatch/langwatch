import type { NextApiRequest, NextApiResponse } from "next";
import { toNodeHandler } from "better-auth/node";
import { auth } from "~/server/better-auth";
import { env } from "~/env.mjs";
import { isAllowedAuthOrigin } from "~/server/better-auth/originGate";

// BetterAuth parses the body itself.
export const config = { api: { bodyParser: false } };

const betterAuthHandler = toNodeHandler(auth.handler);

/**
 * Strict same-origin gate for state-changing requests to `/api/auth/*`.
 *
 * BetterAuth's built-in `originCheckMiddleware` skips origin validation
 * when a request has neither a Cookie header nor Sec-Fetch headers (see
 * `node_modules/better-auth/dist/api/middlewares/origin-check.mjs:102`,
 * `if (!(forceValidate || useCookies)) return;`). This is by design for
 * REST/mobile clients but means a non-browser attacker can POST to
 * `/api/auth/sign-up/email` from any origin and create accounts (caught
 * by iter 45 of the migration audit).
 *
 * This wrapper closes that gap by enforcing same-site origin on POST/
 * PUT/DELETE/PATCH requests *before* the request reaches BetterAuth.
 * Real-browser cross-origin attacks are still blocked by BetterAuth's
 * own `formCsrfMiddleware` (Sec-Fetch-Site validation); this is the
 * non-browser belt-and-suspenders.
 *
 * GET/OPTIONS/HEAD bypass the check (read-only / preflight).
 * Same-origin requests bypass (Origin matches NEXTAUTH_URL).
 * Missing Origin AND missing Referer is REJECTED on state-changing
 * methods — a real browser always sends one of them on POST.
 */
export default async function authHandlerWithOriginGate(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (
    !isAllowedAuthOrigin({
      method: req.method,
      origin: req.headers.origin as string | undefined,
      referer: req.headers.referer as string | undefined,
      baseUrl: env.NEXTAUTH_URL,
    })
  ) {
    res.status(403).json({
      message: "Invalid origin",
      code: "INVALID_ORIGIN",
    });
    return;
  }
  return betterAuthHandler(req, res);
}
