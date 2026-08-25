import type { IntentContext, NewOutboxMessage } from "@langwatch/eventing";
import { z } from "zod";
import {
  GovernanceWebhookPort,
  type GovernanceWebhookEnvelope,
} from "../ports/governance-webhook.port";

export const governanceWebhookEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.literal("1"),
  data: z.record(z.string(), z.string().nullable()),
});

export const deliverGovernanceSchema = z.object({
  organization_id: z.string(),
  project_id: z.string(),
  event_type: z.string(),
  envelope: governanceWebhookEnvelopeSchema,
});

export const governanceSendBatchSchema = z.object({
  organizationId: z.string(),
  endpointId: z.string(),
  batchId: z.string(),
  envelopes: z.array(governanceWebhookEnvelopeSchema),
});

export type DeliverGovernancePayload = z.infer<typeof deliverGovernanceSchema>;

export class GovernanceEventDeliveryIntent {
  private constructor(private readonly port: GovernanceWebhookPort) {}

  static create(port: GovernanceWebhookPort): GovernanceEventDeliveryIntent {
    return new GovernanceEventDeliveryIntent(port);
  }

  get maxAttempts(): number {
    return this.port.maxAttempts;
  }

  retryDelayMs(input: { attempt: number }): number {
    return this.port.retryDelayMs(input);
  }

  async deliver(
    payload: DeliverGovernancePayload,
    _context: IntentContext,
  ): Promise<void> {
    if (!(await this.port.webhooksEnabled(payload.organization_id))) return;
    const endpointIds = await this.port.activeEndpointIds({
      organizationId: payload.organization_id,
      eventType: payload.event_type,
    });
    const now = this.port.now();
    for (const endpointId of endpointIds) {
      await this.commitEndpointSend({ payload, endpointId, now });
    }
  }

  sendBatch(
    payload: {
      organizationId: string;
      endpointId: string;
      batchId: string;
      envelopes: GovernanceWebhookEnvelope[];
    },
    context: IntentContext,
  ): Promise<void> {
    return this.port.sendBatch(payload, context);
  }

  private async commitEndpointSend(input: {
    payload: DeliverGovernancePayload;
    endpointId: string;
    now: number;
  }): Promise<void> {
    const { payload, endpointId, now } = input;
    const ref = {
      processName: "governanceEventsDelivery",
      projectId: payload.project_id,
      processKey: `endpoint:${endpointId}`,
    };
    const existing = await this.port.processStore.findByRef({ ref });
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
    const result = await this.port.processStore.commit({
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
