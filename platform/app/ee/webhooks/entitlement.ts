// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { getApp } from "~/server/app-layer/app";

/** One sentence, used verbatim by every surface that refuses. */
export const WEBHOOK_ENDPOINTS_ENTITLEMENT_MESSAGE =
  "Webhook endpoints are an enterprise feature; this organization's plan does not include them.";

export class WebhookEndpointsNotEntitledError extends Error {
  constructor() {
    super(WEBHOOK_ENDPOINTS_ENTITLEMENT_MESSAGE);
  }
}

/**
 * The one enterprise gate for the webhook platform (and the spend
 * reconciliation surface that ships under the same flag): resolves the
 * organization's active plan and throws when `webhookEndpointsEnabled` is
 * not set. Callers wrap the error in their transport's own shape
 * (ForbiddenError on Hono, FORBIDDEN on tRPC).
 */
export async function assertWebhookEndpointsEntitled(
  organizationId: string,
): Promise<void> {
  const plan = await getApp().planProvider.getActivePlan({ organizationId });
  if (plan.webhookEndpointsEnabled !== true) {
    throw new WebhookEndpointsNotEntitledError();
  }
}
