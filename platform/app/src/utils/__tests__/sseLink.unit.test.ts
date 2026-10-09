/**
 * The SSE link's frame classifier sits between the wire and every tRPC
 * subscription. Its one dangerous ambiguity: `type: "error"` names BOTH the
 * route wrapper's protocol failure and a legitimate domain data entry (the
 * langy turn stream's terminal). Misfiling the domain entry kills the
 * subscription and collapses every live-watched turn failure into the generic
 * unknown card, with the typed cause sitting right there on the wire.
 */
import { describe, expect, it } from "vitest";
import { classifySseFrame } from "../sseLink";

describe("classifySseFrame", () => {
  describe("given the route wrapper's protocol frames", () => {
    describe("when the connection acknowledgement arrives", () => {
      it("classifies it as connected", () => {
        expect(classifySseFrame({ type: "connected" })).toBe("connected");
      });
    });

    describe("when the clean completion arrives", () => {
      it("classifies it as complete", () => {
        expect(classifySseFrame({ type: "complete" })).toBe("complete");
      });
    });

    describe("when an error frame carries a string message", () => {
      it("classifies it as a protocol error", () => {
        expect(
          classifySseFrame({ type: "error", message: "langy_not_enabled" }),
        ).toBe("protocol-error");
      });
    });

    describe("when a bare error frame carries no payload at all", () => {
      it("classifies it as a protocol error", () => {
        expect(classifySseFrame({ type: "error" })).toBe("protocol-error");
      });
    });
  });

  describe("given a subscription data entry whose own union contains an error variant", () => {
    describe("when the langy turn terminal rides the stream", () => {
      /** @scenario "A live-watched failure shows the same card a reload shows" */
      it("passes it through as data, never a dead subscription", () => {
        const turnTerminal = {
          type: "error",
          error: JSON.stringify({
            code: "langy_agent_errored",
            httpStatus: 502,
            reasons: [{ code: "llm_upstream_error" }],
          }),
        };
        expect(classifySseFrame(turnTerminal)).toBe("data");
      });
    });
  });

  describe("given payloads with no protocol discriminant", () => {
    describe("when ordinary data entries arrive", () => {
      it("passes them through untouched", () => {
        expect(
          classifySseFrame({ type: "status", status: "Starting Langy…" }),
        ).toBe("data");
        expect(classifySseFrame({ anything: 1 })).toBe("data");
        expect(classifySseFrame("plain string")).toBe("data");
        expect(classifySseFrame(null)).toBe("data");
      });
    });
  });
});
