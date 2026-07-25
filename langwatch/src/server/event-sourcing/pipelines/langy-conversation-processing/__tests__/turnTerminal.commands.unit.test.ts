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

  /**
   * A user stop is the third way into that same slot. It is neither a
   * completion nor a failure, but it carries an answer, so it rides
   * `agent_responded` with `outcome: "stopped"` (ADR-058) — which means it
   * competes with the natural finish for the ONE terminal a turn is allowed,
   * rather than burying it or being buried by it.
   *
   * @see specs/langy/langy-stop-and-resume.feature
   */
  describe("given a user stop and the turn's natural completion race each other", () => {
    const terminalKeyFor = async (outcome: "completed" | "stopped") => {
      const [event] = await new RecordAgentResponseCommand().handle(
        envelope({
          messageId: outcome === "stopped" ? "partial" : "final",
          role: "assistant",
          parts: [{ type: "text", text: "half an answer" }],
          outcome,
        }) as never,
      );
      return event!.idempotencyKey;
    };

    /** @scenario Stop racing a natural finish resolves to exactly one terminal */
    /** @scenario If the answer already arrived, Stop is a harmless no-op */
    it("puts the stop in the slot the answer holds, so whichever lands first is the only terminal", async () => {
      const stopped = await terminalKeyFor("stopped");
      const completed = await terminalKeyFor("completed");

      expect(stopped).toBeDefined();
      expect(stopped).toBe(completed);
    });

    it("still scopes that slot to the turn, so a stop cannot terminate another one", async () => {
      const [thisTurn] = await new RecordAgentResponseCommand().handle(
        envelope({
          messageId: "partial",
          role: "assistant",
          parts: [],
          outcome: "stopped",
        }) as never,
      );
      const [otherTurn] = await new RecordAgentResponseCommand().handle(
        envelope({
          turnId: "turn-2",
          messageId: "partial",
          role: "assistant",
          parts: [],
          outcome: "stopped",
        }) as never,
      );

      expect(thisTurn!.idempotencyKey).not.toBe(otherTurn!.idempotencyKey);
    });
  });
});
