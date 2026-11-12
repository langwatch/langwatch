import { describe, expect, it } from "vitest";

import { hintForUnknownTraceFilterField } from "../trace-query-unknown-field.ts";

const knownFields = ["status", "label", "user", "conversation", "traceName", "model"];

describe("hintForUnknownTraceFilterField", () => {
  describe("when the field names the trace's text", () => {
    it.each(["input", "output", "metadata.input", "Question"])(
      "points %s at free-text search",
      (field) => {
        expect(hintForUnknownTraceFilterField({ field, knownFields })).toMatchObject({
          kind: "hint",
          text: expect.stringMatching(/quoted phrase and no field/),
        });
      },
    );
  });

  describe("when the field is a known field under another name", () => {
    it.each([
      ["metadata.labels", "label"],
      ["tags", "label"],
      ["user_id", "user"],
      ["metadata.thread_id", "conversation"],
    ])("points %s at @%s", (field, expected) => {
      expect(hintForUnknownTraceFilterField({ field, knownFields })).toEqual({
        kind: "hint",
        text: `Did you mean @${expected}?`,
      });
    });
  });

  describe("when the field is a typo of a known field", () => {
    it("names the field it is closest to", () => {
      expect(hintForUnknownTraceFilterField({ field: "statuz", knownFields })).toEqual({
        kind: "hint",
        text: "Did you mean @status?",
      });
    });
  });

  describe("when nothing is close", () => {
    it("gives no hint", () => {
      expect(hintForUnknownTraceFilterField({ field: "spaceship", knownFields })).toEqual({
        kind: "none",
      });
    });
  });
});
