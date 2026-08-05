import { describe, expect, it } from "vitest";
import { InitiateToolCallCommand } from "~/server/event-sourcing/pipelines/langy-conversation-processing/commands";
import { langyRelayFrameSchema } from "../langyRelayFrame";

/**
 * The real shape: an 8-character tool id with a provider's round-trip blob
 * stapled on. The blob is base64url and kilobytes long — the production value
 * that broke the process-manager inbox index was 2,936 characters.
 */
const REAL_ID = "oljdh6z0";
const SIGNATURE = `Eo4RCosRARFNMg${"AbCd-_09".repeat(360)}`;
const POLLUTED_ID = `${REAL_ID}_ts_${SIGNATURE}`;

function toolFrame({
  id,
  phase = "start",
}: {
  id: string;
  phase?: "start" | "end";
}) {
  return { type: "tool", id, name: "bash", phase };
}

describe("langy tool call id", () => {
  describe("given the agent reports a tool call whose id carries a provider signature", () => {
    describe("when the frame is parsed at the wire boundary", () => {
      /** @scenario A tool id carrying a thought signature is reduced to the real id */
      it("records the tool call under the id the provider issued", () => {
        const parsed = langyRelayFrameSchema.parse(
          toolFrame({ id: POLLUTED_ID }),
        );

        expect(parsed).toMatchObject({ type: "tool", id: REAL_ID });
      });

      /** @scenario A tool id carrying a thought signature is reduced to the real id */
      it("keeps the signature out of everything it parsed", () => {
        const parsed = langyRelayFrameSchema.parse(
          toolFrame({ id: POLLUTED_ID }),
        );

        expect(JSON.stringify(parsed)).not.toContain("_ts_");
        expect(JSON.stringify(parsed)).not.toContain(SIGNATURE.slice(0, 32));
      });
    });
  });

  describe("given the agent reports both the start and the end of that call", () => {
    describe("when each frame is parsed", () => {
      /** @scenario A start and an end frame for the same call still pair up */
      it("resolves both to the same tool call id", () => {
        const start = langyRelayFrameSchema.parse(
          toolFrame({ id: POLLUTED_ID, phase: "start" }),
        );
        // The end frame carries the turn's LATER signature — a different blob
        // for the same call, which is exactly why the raw id could not pair.
        const end = langyRelayFrameSchema.parse(
          toolFrame({
            id: `${REAL_ID}_ts_${"Zz90-_18".repeat(400)}`,
            phase: "end",
          }),
        );

        expect(start).toMatchObject({ id: REAL_ID });
        expect(end).toMatchObject({ id: REAL_ID });
      });
    });
  });

  describe("given the agent reports a tool call with a plain id", () => {
    describe("when the frame is parsed", () => {
      /** @scenario An ordinary tool id is left exactly as it is */
      it("records the id unchanged", () => {
        for (const id of ["toolu_01ABCdef", "call_9xYz", "bash-7", REAL_ID]) {
          expect(langyRelayFrameSchema.parse(toolFrame({ id }))).toMatchObject({
            id,
          });
        }
      });
    });
  });

  describe("given a tool id that contains the separator but no signature", () => {
    describe("when the frame is parsed", () => {
      /** @scenario A separator inside a normal id is not mistaken for a signature */
      it("records the id unchanged", () => {
        // Too short to be a stapled blob, so it is part of the name.
        expect(
          langyRelayFrameSchema.parse(toolFrame({ id: "run_ts_migrations" })),
        ).toMatchObject({ id: "run_ts_migrations" });
      });

      /** @scenario A separator inside a normal id is not mistaken for a signature */
      it("leaves a long suffix alone when it is not base64url", () => {
        const id = `job_ts_${"a.b.c.d.".repeat(12)}`;

        expect(langyRelayFrameSchema.parse(toolFrame({ id }))).toMatchObject({
          id,
        });
      });
    });
  });

  describe("given the agent's final answer lists a tool call carrying a signature", () => {
    describe("when the final frame is parsed", () => {
      /** @scenario A tool call listed on the final answer is normalised the same way */
      it("normalises the listed call the same way", () => {
        const parsed = langyRelayFrameSchema.parse({
          type: "final",
          text: "done",
          toolCalls: [{ id: POLLUTED_ID, name: "bash" }],
        });

        expect(parsed).toMatchObject({
          type: "final",
          toolCalls: [{ id: REAL_ID }],
        });
      });
    });
  });

  describe("given a tool id that is still implausible after stripping", () => {
    describe("when the frame is parsed", () => {
      /** @scenario An absurdly long id is refused as an invalid frame */
      it("rejects the frame rather than storing it", () => {
        const result = langyRelayFrameSchema.safeParse(
          toolFrame({ id: "x".repeat(4000) }),
        );

        expect(result.success).toBe(false);
      });
    });
  });

  describe("given a tool call whose id carried a provider signature", () => {
    describe("when its start is recorded as a durable milestone", () => {
      /** @scenario A tool call's durable key is built from the normalised id */
      it("builds the event's idempotency key from the normalised id", async () => {
        const frame = langyRelayFrameSchema.parse(
          toolFrame({ id: POLLUTED_ID }),
        );
        if (frame.type !== "tool") throw new Error("expected a tool frame");

        const [event] = await new InitiateToolCallCommand().handle({
          type: "langy.conversation.initiate_tool_call",
          tenantId: "project-1",
          data: {
            tenantId: "project-1",
            occurredAt: 1_000,
            conversationId: "langyconv_1",
            turnId: "langyturn_1",
            toolCallId: frame.id,
            toolName: frame.name,
          },
        } as never);

        expect(event!.idempotencyKey).toBe(
          `project-1:langyconv_1:tool-start:${REAL_ID}`,
        );
        expect(event!.idempotencyKey!.length).toBeLessThan(200);
      });
    });
  });
});
