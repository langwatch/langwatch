/**
 * @vitest-environment node
 *
 * The plan is snapshot-typed and last-write-wins: `todowrite` rewrites the whole
 * list each call, so a turn emits MANY plan_updated events and the fold keeps the
 * latest. The idempotency key is therefore turn-scoped AND per-dispatch
 * (occurredAt), mirroring UpdateConversationMetadata — distinct snapshots are
 * distinct events (they must not collapse), while a redelivered frame is already
 * dropped upstream by the relay's frameNonce dedup.
 *
 * @see specs/langy/langy-plan-progress.feature
 */
import { describe, expect, it } from "vitest";
import type { TenantId } from "../../../domain/tenantId";
import { UpdatePlanCommand } from "../commands";

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
      const [turn1] = await new UpdatePlanCommand().handle(
        envelope({}) as never,
      );
      const [turn2] = await new UpdatePlanCommand().handle(
        envelope({ turnId: "turn-2" }) as never,
      );
      expect(turn1!.idempotencyKey).not.toBe(turn2!.idempotencyKey);
    });
  });
});
