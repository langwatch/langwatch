import { getApp } from "~/server/app-layer/app";
import { confirmUnsubscribe } from "~/server/mailer/unsubscribe.read";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:unsubscribe:one-click");

/**
 * ADR-031: RFC 8058 one-click unsubscribe endpoint. Mail clients POST here
 * (body `List-Unsubscribe=One-Click`) when the recipient hits the native
 * "unsubscribe" affordance. The token in `?token=` is the authorization — its
 * HMAC binds it to one recipient — so this route needs no session. One-click
 * is trigger-scoped (the link the `List-Unsubscribe` header carries). Always
 * returns 200 to a valid token so the mail client shows success; only a
 * malformed/missing token is a 4xx.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
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
  } catch {
    return res.status(400).json({ error: "Invalid token" });
  }

  logger.info("One-click unsubscribe processed");
  return res.status(200).json({ ok: true });
}
