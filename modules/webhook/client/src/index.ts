/** The hooks Webhook's own contract generates, and what each procedure answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type { webhookEndpointTrpc } from "@langwatch/webhook-contract";

type WebhookApiMap = ContractApiMap<typeof webhookEndpointTrpc>;

export const webhookClient: ModuleApi<WebhookApiMap> = createModuleApi<WebhookApiMap>();

/** What each procedure answers, as the browser receives it. */
export type WebhookOutputs = OutputsFromMap<WebhookApiMap>;
