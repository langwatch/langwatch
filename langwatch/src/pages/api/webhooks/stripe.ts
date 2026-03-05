import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "~/env.mjs";
import { createStripeWebhookHandler } from "../../../../ee/billing";

export const config = {
  api: {
    bodyParser: false,
  },
};

let webhookHandler: ReturnType<typeof createStripeWebhookHandler> | null = null;

export default async function stripeWebhook(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!env.IS_SAAS) {
    return res.status(404).json({ error: "Not Found" });
  }

  if (!webhookHandler) {
    webhookHandler = createStripeWebhookHandler();
  }

  return await webhookHandler(req, res);
}
