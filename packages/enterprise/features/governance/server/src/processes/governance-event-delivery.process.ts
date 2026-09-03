import type { ProcessManagerApplier } from "@langwatch/eventing";
import {
  deliverGovernanceSchema,
  GovernanceEventDeliveryIntent,
  governanceSendBatchSchema,
} from "../intents/governance-event-delivery.intent";
import {
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
  GovernanceWebhookPort,
  type GovernanceBudgetCrossingData,
  type GovernanceEventsProcessingEvent,
  type GovernanceVkLifecycleData,
  type GovernanceWebhookEnvelope,
} from "../ports/governance-webhook.port";

export const GOVERNANCE_EVENTS_PROCESS_NAME = "governanceEventsDelivery" as const;

export class GovernanceEventDeliveryProcess {
  private constructor(private readonly intent: GovernanceEventDeliveryIntent) {}

  static create(port: GovernanceWebhookPort): GovernanceEventDeliveryProcess {
    return new GovernanceEventDeliveryProcess(GovernanceEventDeliveryIntent.create(port));
  }

  static vkLifecycleEnvelope(data: GovernanceVkLifecycleData): GovernanceWebhookEnvelope {
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

  static budgetCrossingEnvelope(data: GovernanceBudgetCrossingData): GovernanceWebhookEnvelope {
    const type =
      data.kind === "breached" ? "gateway.budget.breached" : "gateway.budget.threshold_crossed";
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

  processManager(): ProcessManagerApplier<GovernanceEventsProcessingEvent> {
    return (process) =>
      process
        .state({})
        .intent("deliverGovernance", deliverGovernanceSchema, (payload, context) =>
          this.intent.deliver(payload, context),
        )
        .intent("sendBatch", governanceSendBatchSchema, (payload, context) =>
          this.intent.sendBatch(payload, context),
        )
        .on(GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE, (state, data, context) => {
          const envelope = GovernanceEventDeliveryProcess.vkLifecycleEnvelope(data);
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
          const envelope = GovernanceEventDeliveryProcess.budgetCrossingEnvelope(data);
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
          maxAttempts: this.intent.maxAttempts,
          retryDelayMs: (input) => this.intent.retryDelayMs(input),
          concurrency: 4,
          batchSize: 8,
          leaseDurationMs: 120_000,
        });
  }
}
