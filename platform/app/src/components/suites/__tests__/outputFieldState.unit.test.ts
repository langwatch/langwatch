import { describe, expect, it } from "vitest";

import {
  DEFAULT_OUTPUT_IDENTIFIER,
  fromOutputFieldState,
  type OutputFieldState,
  resolveOutputField,
  toOutputFieldState,
} from "../outputFieldState";

describe("toOutputFieldState", () => {
  describe("given the value stored on the agent config", () => {
    describe("when nothing has been stored", () => {
      it("reads it as not yet chosen", () => {
        expect(toOutputFieldState(undefined)).toEqual({ kind: "auto" });
      });
    });

    describe("when the stored value is the empty string", () => {
      it("reads it as cleared on purpose", () => {
        expect(toOutputFieldState("")).toEqual({ kind: "cleared" });
      });
    });

    describe("when the stored value names an output", () => {
      it("reads it as the user's choice", () => {
        expect(toOutputFieldState("answer")).toEqual({
          kind: "set",
          value: "answer",
        });
      });
    });

    // The whole point: these two used to be one falsy string.
    describe("when comparing the two states that used to collapse", () => {
      it("tells apart not-yet-chosen from cleared", () => {
        expect(toOutputFieldState(undefined)).not.toEqual(
          toOutputFieldState(""),
        );
      });
    });
  });
});

describe("fromOutputFieldState", () => {
  describe("given each state", () => {
    describe("when writing it back to the stored shape", () => {
      it.each([
        { state: { kind: "auto" } as OutputFieldState, stored: undefined },
        { state: { kind: "cleared" } as OutputFieldState, stored: "" },
        {
          state: { kind: "set", value: "answer" } as OutputFieldState,
          stored: "answer",
        },
      ])("writes $state.kind back as $stored", ({ state, stored }) => {
        expect(fromOutputFieldState(state)).toBe(stored);
      });
    });
  });

  // The stored shape is persisted on the agent config, so this refactor must
  // not move any saved value.
  describe("given a value already stored on an agent", () => {
    describe("when it is read and written back unchanged", () => {
      it.each([
        { stored: undefined },
        { stored: "" },
        { stored: "answer" },
      ])("round-trips $stored unchanged", ({ stored }) => {
        expect(fromOutputFieldState(toOutputFieldState(stored))).toBe(stored);
      });
    });
  });
});

describe("resolveOutputField", () => {
  describe("given the user has not chosen an output", () => {
    describe("when the agent declares one", () => {
      it("falls back to the agent's first declared output", () => {
        expect(
          resolveOutputField({
            state: { kind: "auto" },
            firstDeclaredOutput: "answer",
          }),
        ).toBe("answer");
      });
    });

    describe("when the agent declares none", () => {
      it("falls back to the default identifier", () => {
        expect(
          resolveOutputField({
            state: { kind: "auto" },
            firstDeclaredOutput: undefined,
          }),
        ).toBe(DEFAULT_OUTPUT_IDENTIFIER);
      });
    });
  });

  describe("given the user cleared the selection", () => {
    describe("when an output is still declared", () => {
      it("maps nothing", () => {
        expect(
          resolveOutputField({
            state: { kind: "cleared" },
            firstDeclaredOutput: "answer",
          }),
        ).toBeNull();
      });

      // Cleared must beat the fallback, otherwise clearing silently
      // re-selects the first output and the result cannot be unmapped at all.
      it("does not fall back to the first output", () => {
        expect(
          resolveOutputField({
            state: { kind: "cleared" },
            firstDeclaredOutput: "answer",
          }),
        ).not.toBe("answer");
      });
    });
  });

  describe("given the user chose a specific output", () => {
    describe("when the agent declares a different one first", () => {
      it("uses the user's choice", () => {
        expect(
          resolveOutputField({
            state: { kind: "set", value: "reply" },
            firstDeclaredOutput: "answer",
          }),
        ).toBe("reply");
      });
    });
  });
});
