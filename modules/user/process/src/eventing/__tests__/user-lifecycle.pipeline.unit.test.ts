/**
 * @vitest-environment node
 *
 * user_lifecycle records an account's deactivation and reactivation; peers react from their side
 * (§9).
 * @see modules/user/specs/user.feature
 */
import { createTenantId } from "@langwatch/eventing";
import {
  USER_DEACTIVATED_EVENT_TYPE,
  USER_LIFECYCLE_PIPELINE_NAME,
  USER_REACTIVATED_EVENT_TYPE,
} from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import {
  RecordUserDeactivatedCommand,
  RecordUserReactivatedCommand,
} from "../user-lifecycle.commands.ts";
import type { RecordUserLifecycleCommandData } from "../user-lifecycle.events.ts";
import { buildUserLifecyclePipeline } from "../user-lifecycle.pipeline.ts";

const FACT: RecordUserLifecycleCommandData = {
  tenantId: "user_1",
  userId: "user_1",
  occurredAt: Date.UTC(2026, 9, 1, 12),
};

function command(type: string) {
  return { tenantId: createTenantId("user_1"), aggregateId: "user_1", type, data: FACT };
}

describe("user's lifecycle pipeline", () => {
  /** @scenario "Deactivation and reactivation are recorded as user's facts" */
  it("records a deactivation on the user, keyed so a redelivery collapses", async () => {
    const [event] = await new RecordUserDeactivatedCommand().handle(
      command(RecordUserDeactivatedCommand.schema.type),
    );

    expect(event?.type).toBe(USER_DEACTIVATED_EVENT_TYPE);
    expect(event?.aggregateId).toBe("user_1");
    expect(event?.data).toEqual(FACT);
    expect(event?.idempotencyKey).toBe(`user_1:deactivated:${FACT.occurredAt}`);
  });

  /** @scenario "Deactivation and reactivation are recorded as user's facts" */
  it("records a reactivation the same way", async () => {
    const [event] = await new RecordUserReactivatedCommand().handle(
      command(RecordUserReactivatedCommand.schema.type),
    );

    expect(event?.type).toBe(USER_REACTIVATED_EVENT_TYPE);
    expect(event?.idempotencyKey).toBe(`user_1:reactivated:${FACT.occurredAt}`);
  });

  it("hosts no reaction on its own events", () => {
    const definition = buildUserLifecyclePipeline();

    expect(definition.metadata.name).toBe(USER_LIFECYCLE_PIPELINE_NAME);
    expect(definition.eventSubscribers.size).toBe(0);
  });
});
