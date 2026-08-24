import type {
  IntentContext,
  NewOutboxMessage,
  ProcessManagerApplier,
} from "@langwatch/eventing";
import { z } from "zod";
import {
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
  GovernanceWebhookPort,
  type GovernanceBudgetCrossingData,
  type GovernanceEventsProcessingEvent,
  type GovernanceVkLifecycleData,
  type GovernanceWebhookEnvelope,
} from "../ports/governance-webhook.port";

export const GOVERNANCE_EVENTS_PROCESS_NAME =
  "governanceEventsDelivery" as const;

const envelopeSchema = z.object({
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
  envelope: envelopeSchema,
});

export const governanceSendBatchSchema = z.object({
  organizationId: z.string(),
  endpointId: z.string(),
  batchId: z.string(),
  envelopes: z.array(envelopeSchema),
});

export type DeliverGovernancePayload = z.infer<typeof deliverGovernanceSchema>;

export class GovernanceEventsDeliveryProcessService {
  private constructor(private readonly port: GovernanceWebhookPort) {}

  static create(
    port: GovernanceWebhookPort,
  ): GovernanceEventsDeliveryProcessService {
    return new GovernanceEventsDeliveryProcessService(port);
  }

  static vkLifecycleEnvelope(
    data: GovernanceVkLifecycleData,
  ): GovernanceWebhookEnvelope {
    const type = `gateway.virtual_key.${data.action}`;
    const id = `${data.virtual_key_id}:${data.action}:${data.occurred_at}`;
    return {
      id,
      type,
      created: new Date(data.occurred_at).toISOString(),
      schema_version: "1",
      data: {
        event_id: id,
        event_type: type,
        organization_id: data.organization_id,
        virtual_key_id: data.virtual_key_id,
        name: data.name,
        display_prefix: data.display_prefix,
        reason: data.reason,
        occurred_at: new Date(data.occurred_at).toISOString(),
      },
    };
  }

  static budgetCrossingEnvelope(
    data: GovernanceBudgetCrossingData,
  ): GovernanceWebhookEnvelope {
    const type =
      data.kind === "breached"
        ? "gateway.budget.breached"
        : "gateway.budget.threshold_crossed";
    const id = `${data.budget_id}:${data.bucket_scope_id}:${data.kind}:${data.period_started_at_ms}`;
    return {
      id,
      type,
      created: new Date(data.occurred_at).toISOString(),
      schema_version: "1",
      data: {
        event_id: id,
        event_type: type,
        organization_id: data.organization_id,
        budget_id: data.budget_id,
        scope_type: data.scope_type.toLowerCase(),
        bucket_scope_id: data.bucket_scope_id,
        virtual_key_id: data.virtual_key_id,
        anchor_project_id: data.anchor_project_id,
        end_user_id: data.end_user_id,
        window: data.window.toLowerCase(),
        period_started_at: new Date(data.period_started_at_ms).toISOString(),
        limit_usd: data.limit_usd,
        spent_usd: data.spent_usd,
        on_breach: data.on_breach.toLowerCase(),
        occurred_at: new Date(data.occurred_at).toISOString(),
      },
    };
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

  processManager(): ProcessManagerApplier<GovernanceEventsProcessingEvent> {
    return (process) =>
      process
        .state({})
        .intent(
          "deliverGovernance",
          deliverGovernanceSchema,
          (payload, context) => this.deliver(payload, context),
        )
        .intent("sendBatch", governanceSendBatchSchema, (payload, context) =>
          this.port.sendBatch(payload, context),
        )
        .on(GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE, (state, data, context) => {
          const envelope =
            GovernanceEventsDeliveryProcessService.vkLifecycleEnvelope(data);
          return {
            state,
            intents: [
              context.intents.deliverGovernance(`deliver:${envelope.id}`, {
                organization_id: data.organization_id,
                project_id: context.projectId,
                event_type: envelope.type,
                envelope,
              }),
            ],
          };
        })
        .on(GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE, (state, data, context) => {
          const envelope =
            GovernanceEventsDeliveryProcessService.budgetCrossingEnvelope(data);
          return {
            state,
            intents: [
              context.intents.deliverGovernance(`deliver:${envelope.id}`, {
                organization_id: data.organization_id,
                project_id: context.projectId,
                event_type: envelope.type,
                envelope,
              }),
            ],
          };
        })
        .outbox({
          maxAttempts: this.port.maxAttempts,
          retryDelayMs: (input) => this.port.retryDelayMs(input),
          concurrency: 4,
          batchSize: 8,
          leaseDurationMs: 120_000,
        });
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
