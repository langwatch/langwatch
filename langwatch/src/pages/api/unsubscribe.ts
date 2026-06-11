import { getApp } from "~/server/app-layer/app";
import {
  confirmUnsubscribe,
  InvalidUnsubscribeTokenError,
} from "~/server/mailer/unsubscribe.read";
import { rateLimit } from "~/server/rateLimit";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { getClientIp } from "~/utils/getClientIp";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:unsubscribe:one-click");

/**
 * ADR-031: RFC 8058 one-click unsubscribe endpoint. Mail clients POST here
 * (body `List-Unsubscribe=One-Click`) when the recipient hits the native
 * "unsubscribe" affordance. The token in `?token=` is the authorization — its
 * HMAC binds it to one recipient — so this route needs no session. One-click
 * is trigger-scoped (the link the `List-Unsubscribe` header carries). Always
 * returns 200 to a valid token so the mail client shows success; a
 * malformed/missing token is a 400, non-POST methods get 405, and
 * rate-limited callers get 429.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = getClientIp(req);
  const limit = await rateLimit({
    key: `unsubscribe:one-click:${ip ?? "unknown"}`,
    windowSeconds: 60,
    max: 10,
  });
  if (!limit.allowed) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) {
    return res.status(400).json({ error: "Missing token" });
  }

  try {
    await confirmUnsubscribe({
      token,
      scope: "trigger",
      deps: {
        suppress: ({ projectId, email, triggerId }) =>
          getApp().emailSuppressions.suppress({
            projectId,
            email,
            triggerId,
            reason: "unsubscribe",
          }),
      },
    });
  } catch (err) {
    // Distinguish a bad/tampered token (4xx) from a downstream persistence
    // failure (5xx) — a DB blip must not be reported to the mail client as an
    // invalid link.
    if (err instanceof InvalidUnsubscribeTokenError) {
      return res.status(400).json({ error: "Invalid token" });
    }
    logger.error({ error: err }, "One-click unsubscribe failed");
    return res.status(500).json({ error: "Internal server error" });
  }

  logger.info("One-click unsubscribe processed");
  return res.status(200).json({ ok: true });
}
