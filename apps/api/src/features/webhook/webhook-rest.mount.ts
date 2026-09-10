/**
 * Binds the `/api/webhooks/v1` REST declaration to this process's own root.
 */
import type { WebhookApi } from "@langwatch/webhook-contract";
import { webhookRest } from "@langwatch/webhook-server";
import type { MountableRestApp } from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/webhooks/v1/*`, bound to this process's installed webhook application. */
export function mountWebhookRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ webhooks: () => WebhookApi }>,
): MountableRestApp {
  return runtime.mount(webhookRest.router(), options.webhooks);
}
