// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { eventMatches } from "@ee/webhooks/eventRegistry";
import {
  runWebhookSendBatch,
  sendBatchSchema,
  WEBHOOK_RETRY_LADDER_MS,
  WEBHOOK_SEND_MAX_ATTEMPTS,
  type WebhookDeliveryProcessDeps,
  webhookRetryDelayMs,
} from "@ee/webhooks/process-manager/webhookDelivery.process";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type {
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
} from "~/server/event-sourcing/pipelines/governance-events/schemas/commands";
import {
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/governance-events/schemas/constants";
import type { GovernanceEventsProcessingEvent } from "~/server/event-sourcing/pipelines/governance-events/schemas/events";
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
import type { NewOutboxMessage } from "~/server/event-sourcing/process-manager/stores/processStore.types";
import {
  budgetCrossingToEnvelope,
  vkLifecycleToEnvelope,
} from "../webhooks/governanceEnvelopes";

const logger = createLogger("langwatch:governance:events-delivery");

export const GOVERNANCE_EVENTS_PROCESS_NAME =
  "governanceEventsDelivery" as const;

// Referenced so the ladder constants stay a single import site for both
// delivery processes; the outbox below uses the same retry function.
void WEBHOOK_RETRY_LADDER_MS;

/**
 * Delivers governance events (VK lifecycle, budget crossings) over the
 * webhook platform. Same two-level shape as the spend delivery process:
 * the event handler resolves the org's subscribed endpoints and commits
 * one deterministic per-endpoint send message; runWebhookSendBatch (the
 * platform's own sender) carries the batch through HMAC, the Stripe
 * ladder, the delivery log, and auto-disable. Governance streams are per
 * endpoint under THIS process name, so a dead endpoint blocks only its
 * own governance queue.
 *
 * Crossing dedup: the command store's idempotency key already collapses
 * duplicate (budget, bucket, kind, period) appends, so an event reaching
 * this process IS the once-per-period crossing; the process just fans it
 * out. State stays empty by design.
 */

const deliverGovernanceSchema = z.object({
  organization_id: z.string(),
  project_id: z.string(),
  event_type: z.string(),
  envelope: z.object({
    id: z.string(),
    type: z.string(),
    created: z.string(),
    schema_version: z.literal("1"),
    data: z.record(z.unknown()),
  }),
});
type DeliverGovernancePayload = z.infer<typeof deliverGovernanceSchema>;

/**
 * Commits the one deterministic send an endpoint gets for an envelope.
 * Each endpoint carries its own revision line, so a conflict means a
 * concurrent writer moved that stream and the intent has to run again.
 */
async function commitEndpointSend(
  deps: WebhookDeliveryProcessDeps,
  options: {
    payload: DeliverGovernancePayload;
    endpointId: string;
    now: number;
  },
): Promise<void> {
  const { payload, endpointId, now } = options;
  const ref = {
    processName: GOVERNANCE_EVENTS_PROCESS_NAME,
    projectId: payload.project_id,
    processKey: `endpoint:${endpointId}`,
  };
  const existing = await deps.processStore.findByRef({ ref });
  const batchId = `${endpointId}:${payload.envelope.id}`;
  const message: NewOutboxMessage = {
    messageKey: `send:${batchId}`,
    intentType: "sendBatch",
    payload: {
      organizationId: payload.organization_id,
      projectId: payload.project_id,
      endpointId,
      batchId,
      envelopes: [payload.envelope],
    } as unknown as JsonValue,
    traceCarrier: {},
  };
  const result = await deps.processStore.commit({
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

export function runDeliverGovernance(deps: WebhookDeliveryProcessDeps) {
  return async (
    payload: DeliverGovernancePayload,
    _context: IntentContext,
  ): Promise<void> => {
    const plan = await deps.getPlan(payload.organization_id);
    if (plan.webhookEndpointsEnabled !== true) return;

    const endpoints = (
      await deps.endpoints.getActiveByOrganization({
        organizationId: payload.organization_id,
      })
    ).filter((e) => eventMatches(e.enabledEvents, payload.event_type));
    if (endpoints.length === 0) return;

    const now = (deps.now ?? Date.now)();
    for (const endpoint of endpoints) {
      await commitEndpointSend(deps, {
        payload,
        endpointId: endpoint.id,
        now,
      });
    }
  };
}

export function governanceEventsDeliveryPM(
  deps: WebhookDeliveryProcessDeps,
): ProcessManagerApplier<GovernanceEventsProcessingEvent> {
  return (pm) =>
    pm
      .state<Record<string, JsonValue>>({})
      .intent(
        "deliverGovernance",
        deliverGovernanceSchema,
        runDeliverGovernance(deps),
      )
      .intent("sendBatch", sendBatchSchema, runWebhookSendBatch(deps))
      .on(GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE, (state, data, ctx) => {
        const lifecycle = data as RecordVkLifecycleCommandData;
        const envelope = vkLifecycleToEnvelope(lifecycle);
        return {
          state,
          intents: [
            ctx.intents.deliverGovernance(`deliver:${envelope.id}`, {
              organization_id: lifecycle.organization_id,
              project_id: ctx.projectId,
              event_type: envelope.type,
              envelope,
            }),
          ],
        };
      })
      .on(GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE, (state, data, ctx) => {
        const crossing = data as RecordBudgetCrossingCommandData;
        const envelope = budgetCrossingToEnvelope(crossing);
        return {
          state,
          intents: [
            ctx.intents.deliverGovernance(`deliver:${envelope.id}`, {
              organization_id: crossing.organization_id,
              project_id: ctx.projectId,
              event_type: envelope.type,
              envelope,
            }),
          ],
        };
      })
      .toPayload((event) => event.data as unknown as JsonValue)
      .outbox({
        maxAttempts: WEBHOOK_SEND_MAX_ATTEMPTS,
        retryDelayMs: webhookRetryDelayMs,
        concurrency: 4,
        batchSize: 8,
        leaseDurationMs: 120_000,
      });
}

void logger;
