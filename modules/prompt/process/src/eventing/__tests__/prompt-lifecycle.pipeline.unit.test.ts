/**
 * A project's new prompt is recorded on prompt's own pipeline, and the worker's
 * subscriber tells nurturing. @see specs/features/customer-io-nurturing-integration.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordPromptCreatedCommand } from "../prompt-lifecycle.commands.ts";
import {
  PROMPT_CREATED_EVENT_TYPE,
  PROMPT_CREATED_EVENT_VERSION,
  type PromptCreatedEvent,
} from "../prompt-lifecycle.events.ts";
import { buildPromptLifecyclePipeline } from "../prompt-lifecycle.pipeline.ts";

const created = {
  promptId: "prompt-1",
  projectId: "project-1",
  userId: "user-1",
  orgPromptCount: 1,
};

function createdEvent(): PromptCreatedEvent {
  const [event] = new RecordPromptCreatedCommand().handle({
    tenantId: createTenantId("project-1"),
    type: "lw.prompt.record_created",
    aggregateId: created.promptId,
    data: { tenantId: "project-1", occurredAt: 1_700_000_000_000, ...created },
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

describe("the prompt lifecycle pipeline", () => {
  describe("when the record-created command is handled", () => {
    it("appends one prompt_created event keyed by the prompt", () => {
      expect(createdEvent()).toMatchObject({
        type: PROMPT_CREATED_EVENT_TYPE,
        version: PROMPT_CREATED_EVENT_VERSION,
        aggregateType: "prompt",
        aggregateId: "prompt-1",
        idempotencyKey: "project-1:prompt-1:created",
        data: created,
      });
    });
  });

  describe("when the worker's subscriber handles prompt_created", () => {
    /** @scenario "First prompt creation identifies user with has_prompts true" */
    it("tells nurturing the prompt and its org-wide count with the event it came from", async () => {
      const recorded: NurturingSignal[] = [];
      const subscriber = buildPromptLifecyclePipeline({
        recordSignal: async (signal) => {
          recorded.push(signal);
        },
      }).eventSubscribers.get("promptCreatedNurturing");
      if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");
      const event = createdEvent();

      await subscriber.handle(event, { tenantId: "project-1", aggregateId: "prompt-1" });

      expect(recorded).toEqual([
        {
          kind: "prompt_created",
          sourceEventId: event.id,
          tenantId: "project-1",
          occurredAt: 1_700_000_000_000,
          ...created,
        },
      ]);
    });

    it("lets a nurturing failure reach the queue, which retries it", async () => {
      const subscriber = buildPromptLifecyclePipeline({
        recordSignal: async () => {
          throw new Error("nurturing unavailable");
        },
      }).eventSubscribers.get("promptCreatedNurturing");
      if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");

      await expect(
        subscriber.handle(createdEvent(), { tenantId: "project-1", aggregateId: "prompt-1" }),
      ).rejects.toThrow("nurturing unavailable");
    });
  });
});
