/**
 * A turn reaches exactly ONE terminal:
 * @vitest-environment node
 * @see specs/langy/langy-turn-recovery.feature
 */

import type { TenantId } from "@langwatch/eventing";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import {
  FailAgentResponseCommand,
  FailToolCallCommand,
  RecordAgentResponseCommand,
  SucceedToolCallCommand,
} from "../langy-conversation.intent.ts";

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
   * A user stop is the third way into that same slot.
   * `agent_responded` with `outcome: "stopped"` (ADR-078) — which means it
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

  describe("given a tool call the agent initiated during a response", () => {
    const toolCall = (data: Record<string, unknown> = {}) =>
      envelope({
        toolCallId: "tc-1",
        toolName: "bash",
        command: "grep -r failing traces",
        ...data,
      });

    /** @scenario "A tool call reaches exactly one terminal, succeeded or failed" */
    it("records the success with the command and duration, in the one slot a failure would also take", async () => {
      const [succeeded] = await new SucceedToolCallCommand().handle(
        toolCall({ durationMs: 42 }) as never,
      );
      const [failed] = await new FailToolCallCommand().handle(
        toolCall({ errorText: "exit 1" }) as never,
      );

      expect(succeeded!.type).toBe(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED);
      expect(succeeded!.data).toEqual(
        expect.objectContaining({
          toolCallId: "tc-1",
          command: "grep -r failing traces",
          durationMs: 42,
        }),
      );
      // Both terminals compete for the same `tool-done` slot, so the call can
      // only ever carry one of them: a later contradictory failure collapses
      // into the success already stored.
      expect(succeeded!.idempotencyKey).toBeDefined();
      expect(succeeded!.idempotencyKey).toBe(failed!.idempotencyKey);
    });

    /** @scenario "A failing tool call is a distinct event carrying the error" */
    it("records the failure as its own event carrying the error, in the slot a success would also take", async () => {
      const [failed] = await new FailToolCallCommand().handle(
        toolCall({ errorText: "exit 1: no such file" }) as never,
      );
      const [succeeded] = await new SucceedToolCallCommand().handle(
        toolCall({ durationMs: 42 }) as never,
      );

      expect(failed!.type).toBe(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED);
      expect(failed!.type).not.toBe(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED);
      expect(failed!.data).toEqual(
        expect.objectContaining({
          toolCallId: "tc-1",
          errorText: "exit 1: no such file",
        }),
      );
      expect(failed!.idempotencyKey).toBe(succeeded!.idempotencyKey);
    });

    it("scopes that slot to the call, so one tool call never terminates another", async () => {
      const [first] = await new FailToolCallCommand().handle(
        toolCall({ errorText: "exit 1" }) as never,
      );
      const [second] = await new FailToolCallCommand().handle(
        toolCall({ toolCallId: "tc-2", errorText: "exit 1" }) as never,
      );

      expect(first!.idempotencyKey).not.toBe(second!.idempotencyKey);
    });
  });
});
