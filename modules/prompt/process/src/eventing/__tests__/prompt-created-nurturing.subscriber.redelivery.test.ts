import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  PROMPT_CREATED_EVENT_TYPE,
  PROMPT_CREATED_EVENT_VERSION,
  type PromptCreatedEvent,
} from "../prompt-lifecycle.events.ts";
import { buildPromptLifecyclePipeline } from "../prompt-lifecycle.pipeline.ts";

const event: PromptCreatedEvent = {
  id: "event-1",
  aggregateId: "prompt-1",
  aggregateType: "prompt",
  tenantId: createTenantId("project-1"),
  createdAt: 1_700_000_000_000,
  occurredAt: 1_700_000_000_000,
  type: PROMPT_CREATED_EVENT_TYPE,
  version: PROMPT_CREATED_EVENT_VERSION,
  data: { promptId: "prompt-1", projectId: "project-1", userId: "user-1", orgPromptCount: 1 },
};

const context = { tenantId: "project-1", aggregateId: "prompt-1" };

/** Nurturing as it behaves: one signal per kind and source event, however often it is told. */
function nurturing() {
  const signals = new Map<string, NurturingSignal>();
  return {
    signals,
    recordSignal: async (signal: NurturingSignal) => {
      signals.set(`${signal.kind}:${signal.sourceEventId}`, signal);
    },
  };
}

describe("the prompt-created nurturing subscriber on redelivery", () => {
  it("tells nurturing one signal when the same event is handled twice", async () => {
    const target = nurturing();
    const subscriber =
      buildPromptLifecyclePipeline(target).eventSubscribers.get("promptCreatedNurturing");
    if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");

    await subscriber.handle(event, context);
    await subscriber.handle(event, context);

    expect([...target.signals.values()]).toEqual([
      {
        kind: "prompt_created",
        sourceEventId: "event-1",
        tenantId: "project-1",
        occurredAt: 1_700_000_000_000,
        promptId: "prompt-1",
        projectId: "project-1",
        userId: "user-1",
        orgPromptCount: 1,
      },
    ]);
  });
});
