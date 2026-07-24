/**
 * The SSE link's frame classifier sits between the wire and every tRPC
 * subscription. Its one dangerous ambiguity: `type: "error"` names BOTH the
 * route wrapper's protocol failure and a legitimate domain data entry (the
 * langy turn stream's terminal). Misfiling the domain entry kills the
 * subscription and collapses every live-watched turn failure into the generic
 * unknown card — with the typed cause sitting right there on the wire.
 */
import { describe, expect, it } from "vitest";
import { classifySseFrame } from "../sseLink";

describe("classifySseFrame", () => {
  describe("given the route wrapper's protocol frames", () => {
    it("recognises the connection acknowledgement", () => {
      expect(classifySseFrame({ type: "connected" })).toBe("connected");
    });

    it("recognises the clean completion", () => {
      expect(classifySseFrame({ type: "complete" })).toBe("complete");
    });

    it("treats an error frame carrying a string message as a protocol error", () => {
      expect(classifySseFrame({ type: "error", message: "langy_not_enabled" })).toBe(
        "protocol-error",
      );
    });

    it("treats a bare error frame with no payload as a protocol error", () => {
      expect(classifySseFrame({ type: "error" })).toBe("protocol-error");
    });
  });

  // @scenario "A live-watched failure shows the same card a reload shows"
  describe("given a subscription data entry whose own union contains an error variant", () => {
    it("passes the langy turn terminal through as data, never a dead subscription", () => {
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

  describe("given payloads with no protocol discriminant", () => {
    it("passes ordinary data entries through", () => {
      expect(classifySseFrame({ type: "status", status: "Poking Langy…" })).toBe(
        "data",
      );
      expect(classifySseFrame({ anything: 1 })).toBe("data");
      expect(classifySseFrame("plain string")).toBe("data");
      expect(classifySseFrame(null)).toBe("data");
    });
  });
});
