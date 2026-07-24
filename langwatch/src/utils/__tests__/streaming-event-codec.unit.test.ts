import { describe, it, expect } from "vitest";
import {
  encodeStart,
  encodeContent,
  encodeEnd,
  isCompactStreamingEvent,
} from "../streaming-event-codec";

describe("streaming-event-codec", () => {
  const baseFields = {
    scenarioRunId: "run_1",
    batchRunId: "batch_1",
    messageId: "msg_1",
  };

  describe("encodeStart()", () => {
    describe("when messageIndex is not provided", () => {
      it("produces JSON with e='S' and no i key", () => {
        const result = JSON.parse(
          encodeStart({ ...baseFields, role: "assistant" }),
        );

        expect(result).toEqual({
          e: "S",
          r: "run_1",
          b: "batch_1",
          m: "msg_1",
          l: "assistant",
        });
        expect(result).not.toHaveProperty("i");
      });
    });

    describe("when messageIndex is provided", () => {
      it("includes the i key with the index value", () => {
        const result = JSON.parse(
          encodeStart({ ...baseFields, role: "user", messageIndex: 3 }),
        );

        expect(result).toEqual({
          e: "S",
          r: "run_1",
          b: "batch_1",
          m: "msg_1",
          l: "user",
          i: 3,
        });
      });
    });

    describe("when messageIndex is 0", () => {
      it("includes the i key with value 0", () => {
        const result = JSON.parse(
          encodeStart({ ...baseFields, role: "user", messageIndex: 0 }),
        );

        expect(result.i).toBe(0);
      });
    });
  });

  describe("encodeContent()", () => {
    describe("when delta is a simple string", () => {
      it("produces JSON with e='C' and delta preserved exactly", () => {
        const result = JSON.parse(
          encodeContent({ ...baseFields, delta: "hello" }),
        );

        expect(result).toEqual({
          e: "C",
          r: "run_1",
          b: "batch_1",
          m: "msg_1",
          d: "hello",
        });
      });
    });

    describe("when delta contains special characters", () => {
      it("preserves whitespace and unicode exactly", () => {
        const delta = "  line1\nline2\ttab \u2603";
        const result = JSON.parse(
          encodeContent({ ...baseFields, delta }),
        );

        expect(result.d).toBe(delta);
      });
    });

    describe("when delta is an empty string", () => {
      it("preserves the empty string", () => {
        const result = JSON.parse(
          encodeContent({ ...baseFields, delta: "" }),
        );

        expect(result.d).toBe("");
      });
    });
  });

  describe("encodeEnd()", () => {
    describe("when content is not provided", () => {
      it("produces JSON with e='E' and no c key", () => {
        const result = JSON.parse(encodeEnd(baseFields));

        expect(result).toEqual({
          e: "E",
          r: "run_1",
          b: "batch_1",
          m: "msg_1",
        });
        expect(result).not.toHaveProperty("c");
      });
    });

    describe("when content is provided", () => {
      it("includes the c key with the content value", () => {
        const result = JSON.parse(
          encodeEnd({ ...baseFields, content: "full message" }),
        );

        expect(result).toEqual({
          e: "E",
          r: "run_1",
          b: "batch_1",
          m: "msg_1",
          c: "full message",
        });
      });
    });

    describe("when content is an empty string", () => {
      it("includes the c key with empty string", () => {
        const result = JSON.parse(
          encodeEnd({ ...baseFields, content: "" }),
        );

        // empty string is falsy but not null/undefined, so it should be included
        // Actually, the implementation checks `!= null`, so empty string IS included
        expect(result.c).toBe("");
      });
    });
  });

  describe("isCompactStreamingEvent()", () => {
    describe("when parsed has e='S'", () => {
      it("returns true", () => {
        expect(isCompactStreamingEvent({ e: "S", r: "r", b: "b", m: "m" })).toBe(true);
      });
    });

    describe("when parsed has e='C'", () => {
      it("returns true", () => {
        expect(isCompactStreamingEvent({ e: "C", r: "r", b: "b", m: "m" })).toBe(true);
      });
    });

    describe("when parsed has e='E'", () => {
      it("returns true", () => {
        expect(isCompactStreamingEvent({ e: "E", r: "r", b: "b", m: "m" })).toBe(true);
      });
    });

    describe("when parsed has an unrecognized event type", () => {
      it("returns false for e='X'", () => {
        expect(isCompactStreamingEvent({ e: "X" })).toBe(false);
      });
    });

    describe("when parsed is null", () => {
      it("returns false", () => {
        expect(isCompactStreamingEvent(null)).toBe(false);
      });
    });

    describe("when parsed is undefined", () => {
      it("returns false", () => {
        expect(isCompactStreamingEvent(undefined)).toBe(false);
      });
    });

    describe("when parsed is a string", () => {
      it("returns false", () => {
        expect(isCompactStreamingEvent("S")).toBe(false);
      });
    });

    describe("when parsed is an object without e property", () => {
      it("returns false", () => {
        expect(isCompactStreamingEvent({ r: "r", b: "b" })).toBe(false);
      });
    });
  });

  describe("roundtrip", () => {
    describe("when each encode output is parsed and checked", () => {
      it("passes isCompactStreamingEvent for encodeStart output", () => {
        const encoded = encodeStart({ ...baseFields, role: "assistant" });
        const parsed = JSON.parse(encoded);
        expect(isCompactStreamingEvent(parsed)).toBe(true);
      });

      it("passes isCompactStreamingEvent for encodeContent output", () => {
        const encoded = encodeContent({ ...baseFields, delta: "chunk" });
        const parsed = JSON.parse(encoded);
        expect(isCompactStreamingEvent(parsed)).toBe(true);
      });

      it("passes isCompactStreamingEvent for encodeEnd output", () => {
        const encoded = encodeEnd({ ...baseFields, content: "done" });
        const parsed = JSON.parse(encoded);
        expect(isCompactStreamingEvent(parsed)).toBe(true);
      });
    });
  });
});
