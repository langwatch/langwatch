import type { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import type { SubscriberSpec } from "@langwatch/eventing";

import { PROMPT_CREATED_EVENT_TYPE, type PromptLifecycleEvent } from "./prompt-lifecycle.events.ts";

export type PromptCreatedNurturingDeps = Pick<NurturingApi, "recordSignal">;

/** Tells nurturing a prompt was created (§9); it sends the signal once per event. */
export function createPromptCreatedNurturingSubscriber(
  nurturing: PromptCreatedNurturingDeps,
): SubscriberSpec<PromptLifecycleEvent> & { fold?: never; map?: never } {
  return {
    events: [PROMPT_CREATED_EVENT_TYPE],
    handler: (event: PromptLifecycleEvent) =>
      nurturing.recordSignal({
        kind: "prompt_created",
        sourceEventId: event.id,
        tenantId: String(event.tenantId),
        occurredAt: event.occurredAt,
        ...event.data,
      }),
  };
}
