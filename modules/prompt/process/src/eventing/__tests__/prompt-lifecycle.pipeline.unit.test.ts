/**
 * A project's new prompt is recorded on prompt's own pipeline, and nurturing
 * reacts to its event from its own side.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { PROMPT_CREATED_EVENT_TYPE } from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";

import { RecordPromptCreatedCommand } from "../prompt-lifecycle.commands.ts";
import {
  PROMPT_CREATED_EVENT_VERSION,
  type PromptCreatedEvent,
} from "../prompt-lifecycle.events.ts";

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
});
