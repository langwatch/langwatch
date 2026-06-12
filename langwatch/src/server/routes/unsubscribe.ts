/**
 * Hono route for the RFC 8058 one-click unsubscribe endpoint.
 *
 * Replaces:
 * - src/pages/api/unsubscribe.ts
 *
 * ADR-031: RFC 8058 one-click unsubscribe endpoint. Mail clients POST here
 * (body `List-Unsubscribe=One-Click`) when the recipient hits the native
 * "unsubscribe" affordance. The token in `?token=` is the authorization — its
 * HMAC binds it to one recipient — so this route needs no session. One-click
 * is trigger-scoped (the link the `List-Unsubscribe` header carries). Always
 * returns 200 to a valid token so the mail client shows success; a
 * malformed/missing token is a 400, non-POST methods get 405, and
 * rate-limited callers get 429.
 */
import type { Context } from "hono";
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { InvalidUnsubscribeTokenError } from "~/server/app-layer/triggers/emailSuppression.service";
import { rateLimit } from "~/server/rateLimit";
import type { NextApiRequest } from "~/types/next-stubs";
import { getClientIp } from "~/utils/getClientIp";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:unsubscribe:one-click");

const secured = createServiceApp({ basePath: "/api" });

/**
 * Reuses getClientIp's header-priority logic against the Hono request by
 * adapting the Hono header record into the NextApiRequest shape it expects.
 */
function clientIpFromContext(c: Context): string | undefined {
  return getClientIp({
    headers: c.req.header(),
  } as unknown as NextApiRequest);
}

secured
  .access(
    publicEndpoint(
      "RFC 8058 one-click unsubscribe; HMAC token in ?token= is the authorization, no session",
    ),
  )
  .post("/unsubscribe", async (c) => {
    const ip = clientIpFromContext(c);
    const limit = await rateLimit({
      key: `unsubscribe:one-click:${ip ?? "unknown"}`,
      windowSeconds: 60,
      max: 10,
    });
    if (!limit.allowed) {
      return c.json({ error: "Too many requests" }, 429);
    }

    const token = c.req.query("token") ?? null;
    if (!token) {
      return c.json({ error: "Missing token" }, 400);
    }

    try {
      await getApp().emailSuppressions.confirmUnsubscribe({
        token,
        scope: "trigger",
      });
    } catch (err) {
      // Distinguish a bad/tampered token (4xx) from a downstream persistence
      // failure (5xx) — a DB blip must not be reported to the mail client as an
      // invalid link.
      if (err instanceof InvalidUnsubscribeTokenError) {
        return c.json({ error: "Invalid token" }, 400);
      }
      logger.error({ error: err }, "One-click unsubscribe failed");
      return c.json({ error: "Internal server error" }, 500);
    }

    logger.info("One-click unsubscribe processed");
    return c.json({ ok: true });
  });

// RFC 8058 one-click is POST-only. Registered AFTER the POST route so that a
// POST request resolves to the handler above; every other method falls through
// to here for a 405 with an Allow header (matching the legacy contract) rather
// than a bare 404.
secured
  .access(
    publicEndpoint(
      "RFC 8058 one-click unsubscribe; method guard returns 405 for non-POST",
    ),
  )
  .all("/unsubscribe", (c) => {
    c.header("Allow", "POST");
    return c.json({ error: "Method not allowed" }, 405);
  });

export const app = secured.hono;
