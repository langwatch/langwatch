import type { IntentContext, NewOutboxMessage, ProcessManagerApplier } from "@langwatch/eventing";
import { eventMatches } from "@langwatch/webhook-contract";
import { z } from "zod";

import {
  type WebhookDeliveryEvent,
  webhookGovernanceDeliveryRequestedEventSchema,
} from "../eventing/webhook-governance-delivery.intent.ts";
import {
  GOVERNANCE_EVENTS_PROCESS_NAME,
  sendBatchSchema,
  WEBHOOK_SEND_MAX_ATTEMPTS,
} from "../rules/webhook-delivery-contract.rules.ts";
import {
  budgetCrossingEnvelope,
  governanceEnvelopeSchema,
  virtualKeyLifecycleEnvelope,
} from "../rules/webhook-governance-envelope.rules.ts";
import { WebhookBatchSendService } from "./webhook-batch-send.service.ts";
import {
  WebhookDeliveryService,
  type WebhookDeliveryProcessDeps,
} from "./webhook-delivery.service.ts";

const deliverGovernanceSchema = z.object({
  organization_id: z.string(),
  project_id: z.string(),
  event_type: z.string(),
  envelope: governanceEnvelopeSchema,
});
type DeliverGovernancePayload = z.infer<typeof deliverGovernanceSchema>;
const governanceDeliveryStateSchema = z.object({});

/**
 * Main's governance delivery: each fact becomes one envelope, sent at once as a batch
 * of one on each subscribed endpoint's own governance stream, so a dead endpoint blocks
 * only its own queue. State stays empty: gateway's command key made each crossing once.
 */
export class WebhookGovernanceDeliveryService {
  private readonly batchSend: WebhookBatchSendService;

  private constructor(private readonly deps: WebhookDeliveryProcessDeps) {
    this.batchSend = WebhookBatchSendService.create(deps);
  }

  static create(deps: WebhookDeliveryProcessDeps): WebhookGovernanceDeliveryService {
    return new WebhookGovernanceDeliveryService(deps);
  }

  processManager(): ProcessManagerApplier<WebhookDeliveryEvent> {
    return (process) =>
      process
        .state(governanceDeliveryStateSchema, {})
        .intent("deliverGovernance", deliverGovernanceSchema, (payload, context) =>
          this.deliver(payload, context),
        )
        .intent("sendBatch", sendBatchSchema, this.batchSend.run())
        .on(webhookGovernanceDeliveryRequestedEventSchema, (state, { governance }, context) => {
          const envelope =
            governance.type === "lw.governance.budget_crossing"
              ? budgetCrossingEnvelope(governance.data)
              : virtualKeyLifecycleEnvelope(governance.data);
          return {
            state,
            intents: [
              context.intent("deliverGovernance", `deliver:${envelope.id}`, {
                organization_id: governance.data.organization_id,
                project_id: context.projectId,
                event_type: envelope.type,
                envelope,
              }),
            ],
          };
        })
        .outbox({
          maxAttempts: WEBHOOK_SEND_MAX_ATTEMPTS,
          retryDelayMs: (input) => WebhookDeliveryService.retryDelayMs(input),
          concurrency: 4,
          batchSize: 8,
          leaseDurationMs: 120_000,
        });
  }

  /** Commits one send per subscribed endpoint; a revision conflict retries the intent. */
  async deliver(payload: DeliverGovernancePayload, _context: IntentContext): Promise<void> {
    const plan = await this.deps.getPlan(payload.organization_id);
    if (plan.webhookEndpointsEnabled !== true) return;
    const endpoints = (
      await this.deps.endpoints.findActiveByOrganization({
        organizationId: payload.organization_id,
      })
    ).filter((endpoint) => eventMatches(endpoint.enabledEvents, payload.event_type));
    const now = (this.deps.now ?? Date.now)();
    for (const endpoint of endpoints) {
      await this.commitEndpointSend({ payload, endpointId: endpoint.id, now });
    }
  }

  private async commitEndpointSend(input: {
    payload: DeliverGovernancePayload;
    endpointId: string;
    now: number;
  }): Promise<void> {
    const { payload, endpointId, now } = input;
    const ref = {
      processName: GOVERNANCE_EVENTS_PROCESS_NAME,
      projectId: payload.project_id,
      processKey: `endpoint:${endpointId}`,
    };
    const existing = await this.deps.processStore.findByRef({ ref });
    const batchId = `${endpointId}:${payload.envelope.id}`;
    const message: NewOutboxMessage = {
      messageKey: `send:${batchId}`,
      intentType: "sendBatch",
      payload: {
        organizationId: payload.organization_id,
        endpointId,
        batchId,
        envelopes: [payload.envelope],
      },
      traceCarrier: {},
    };
    const result = await this.deps.processStore.commit({
      ref,
      tenantId: payload.project_id,
      sourceEventId: `deliver:${batchId}`,
      expectedRevision: existing?.revision ?? 0,
      state: existing?.state ?? {},
      nextWakeAt: existing?.nextWakeAt ?? null,
      messages: [message],
      now,
    });
    if (result.outcome === "revisionConflict") {
      throw new Error(
        `governance deliver hit a revision conflict on endpoint ${endpointId}; retrying`,
      );
    }
  }
}
