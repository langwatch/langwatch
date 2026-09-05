/**
 * The plan is snapshot-typed and last-write-wins: `todowrite` rewrites the whole list each call,
 * @vitest-environment node
 * @see specs/langy/langy-plan-progress.feature
 */

import type { TenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { UpdatePlanCommand } from "../../intents/langy-conversation.intent";

const TENANT = "project-1";
const CONVERSATION = "conv-1";
const TURN = "turn-1";

function envelope(data: Record<string, unknown>) {
  return {
    tenantId: TENANT as TenantId,
    aggregateId: CONVERSATION,
    data: {
      tenantId: TENANT,
      occurredAt: 1700000000000,
      conversationId: CONVERSATION,
      turnId: TURN,
      items: [{ content: "Step", status: "in_progress" }],
      ...data,
    },
  };
}

describe("UpdatePlan command", () => {
  describe("given two distinct snapshots of the same turn's plan", () => {
    it("keys them separately so the later snapshot is not collapsed away", async () => {
      const [first] = await new UpdatePlanCommand().handle(
        envelope({ occurredAt: 1700000000000 }) as never,
      );
      const [second] = await new UpdatePlanCommand().handle(
        envelope({ occurredAt: 1700000000500 }) as never,
      );
      expect(first!.idempotencyKey).not.toBe(second!.idempotencyKey);
    });

    it("scopes the plan slot to the turn so different turns never collide", async () => {
      const [turn1] = await new UpdatePlanCommand().handle(envelope({}) as never);
      const [turn2] = await new UpdatePlanCommand().handle(envelope({ turnId: "turn-2" }) as never);
      expect(turn1!.idempotencyKey).not.toBe(turn2!.idempotencyKey);
    });
  });
});
