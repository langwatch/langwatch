/**
 * @vitest-environment node
 *
 * A turn reaches exactly ONE terminal: `agent_responded` (the answer) or
 * `agent_response_failed` (the liveness sweep gave up). The two commands used
 * to occupy DIFFERENT idempotency slots (`turn-final:` vs `turn-failed:`), so
 * a stale failure racing a completed answer produced BOTH terminals and the
 * failure buried the answer. They now share a `turn-terminal:` slot — the
 * first terminal for a turnId wins, exactly like the tool-call commands'
 * shared `tool-done:` slot.
 *
 * @see specs/langy/langy-turn-recovery.feature
 */
import { describe, expect, it } from "vitest";
import type { TenantId } from "../../../domain/tenantId";
import {
  FailAgentResponseCommand,
  RecordAgentResponseCommand,
} from "../commands";

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
      ...data,
    },
  };
}

describe("turn terminal commands", () => {
  describe("given a turn whose completion and stale failure race each other", () => {
    describe("when both commands emit their events", () => {
      it("stamps the SAME idempotency key on both terminals, so the first wins", async () => {
        const [responded] = await new RecordAgentResponseCommand().handle(
          envelope({
            messageId: "a1",
            role: "assistant",
            parts: [],
            outcome: "completed",
          }) as never,
        );
        const [failed] = await new FailAgentResponseCommand().handle(
          envelope({ error: "worker stopped" }) as never,
        );

        expect(responded!.idempotencyKey).toBeDefined();
        expect(responded!.idempotencyKey).toBe(failed!.idempotencyKey);
      });

      it("scopes the terminal slot to the turn, so different turns never collide", async () => {
        const [turn1] = await new FailAgentResponseCommand().handle(
          envelope({ error: "worker stopped" }) as never,
        );
        const [turn2] = await new FailAgentResponseCommand().handle(
          envelope({ turnId: "turn-2", error: "worker stopped" }) as never,
        );

        expect(turn1!.idempotencyKey).not.toBe(turn2!.idempotencyKey);
      });
    });
  });
});
