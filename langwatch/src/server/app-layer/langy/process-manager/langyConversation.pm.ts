import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type { IntentExecutor } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { IntentHandler } from "~/server/event-sourcing/process-manager/outbox/outboxDispatcherService";
import { LANGY_CONVERSATION_PROCESSING_EVENT_TYPES } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

import {
  langyConversationProcessDefinition,
  toLangyProcessEnvelope,
} from "./langyConversationProcess.definition";
import {
  createLangyIntentHandlers,
  LANGY_OUTBOX_LEASE_DURATION_MS,
  type LangyEffectPorts,
} from "./langyEffectPorts";
import {
  LANGY_PROCESS_INTENT_TYPES,
  langyGenerateTitleIntentSchema,
  langyWorkerDispatchIntentSchema,
  type LangyConversationProcessState,
} from "./langyConversationProcess.types";

/**
 * ADR-049's pilot process manager on the ADR-052 `withProcessManager`
 * surface. The proven pure core (`langyConversationProcessDefinition`)
 * stays byte-identical — the applier adapts it:
 *
 * - the feed is the content boundary: it maps each committed pipeline
 *   event to the content-stripped process view (parts/tokens/titles never
 *   reach process state or outbox rows), keyed by conversation;
 * - each `on` handler reconstructs the envelope the legacy evolve
 *   consumed, so the definition and its unit tests are untouched;
 * - the intent executors wrap the existing effect-port handlers.
 */
export const langyConversationPM =
  (deps: {
    ports: LangyEffectPorts;
  }): ProcessManagerApplier<LangyConversationProcessingEvent> =>
  (pm) => {
    const legacyHandlers = createLangyIntentHandlers({ ports: deps.ports });
    const adapt =
      (intentType: string): IntentExecutor<unknown> =>
      async (payload, context) => {
        const handler: IntentHandler | undefined = legacyHandlers[intentType];
        if (!handler) {
          throw new Error(`No langy handler for intent "${intentType}"`);
        }
        await handler({
          message: {
            processName: context.processName,
            projectId: context.projectId,
            processKey: context.processKey,
            tenantId: context.tenantId,
            messageKey: context.messageKey,
            intentType,
            payload: payload as never,
            sourceEventId: null,
            attempt: context.attempt,
          },
        });
      };

    let builder = pm
      .state<LangyConversationProcessState>(
        langyConversationProcessDefinition.initialState,
      )
      .intent(
        LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH,
        langyWorkerDispatchIntentSchema,
        adapt(LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH),
      )
      .intent(
        LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
        langyGenerateTitleIntentSchema,
        adapt(LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE),
      );

    // One `on` per pipeline event type, all delegating to the proven pure
    // evolve — the fact data IS the legacy content-stripped view.
    for (const eventType of LANGY_CONVERSATION_PROCESSING_EVENT_TYPES) {
      builder = builder.on(
        eventType,
        (state: LangyConversationProcessState, data, { at, key, projectId }) =>
          langyConversationProcessDefinition.evolve({
            previousState: state,
            input: {
              kind: "event",
              event: {
                eventId: "", // unused by the pure evolve; inbox identity is framework-owned
                eventType,
                occurredAt: at,
                tenantId: projectId,
                projectId,
                processKey: key,
                payload: data as never,
              },
            },
          }),
      ) as unknown as typeof builder;
    }

    return builder
      .trigger({
        events: LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
        // The per-type `on` handlers are registered in a loop, so the
        // accumulated Facts generic is erased — the runtime dispatch is
        // exact (fact name = event type), hence the cast.
        feed: (async (event: LangyConversationProcessingEvent) => {
          const envelope = toLangyProcessEnvelope(event);
          return [
            {
              key: envelope.processKey,
              fact: event.type,
              data: envelope.payload,
            },
          ];
        }) as never,
      })
      .outbox({
        // The lease MUST outlive the slowest accepted dispatch, or a
        // healthy long-running turn loses its lease mid-flight and a second
        // instance re-delivers it concurrently. The generic 30s default is
        // unsafe against the 60s dispatch budget.
        leaseDurationMs: LANGY_OUTBOX_LEASE_DURATION_MS,
      });
  };
