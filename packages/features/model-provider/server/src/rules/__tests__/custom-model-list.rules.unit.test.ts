/**
 * Both shapes a custom model list has ever been sent in.
 */

import { describe, expect, it } from "vitest";
import { toCanonicalCustomModelList } from "../custom-model-list.rules";

describe("toCanonicalCustomModelList", () => {
  describe("given the string shape the field started as", () => {
    it("reads each id as its own label", () => {
      expect(toCanonicalCustomModelList(["gpt-5-mini"], "chat")).toEqual([
        { id: "gpt-5-mini", label: "gpt-5-mini", type: "chat" },
      ]);
    });
  });

  describe("given the object shape it takes now", () => {
    it("reads the display name as the label", () => {
      expect(
        toCanonicalCustomModelList([{ modelId: "gpt-5-mini", displayName: "Fast" }], "chat"),
      ).toEqual([{ id: "gpt-5-mini", label: "Fast", type: "chat" }]);
    });

    it("falls back to the id when no display name was given", () => {
      expect(toCanonicalCustomModelList([{ modelId: "gpt-5-mini" }], "embedding")).toEqual([
        { id: "gpt-5-mini", label: "gpt-5-mini", type: "embedding" },
      ]);
    });

    it("ignores a display name that is not text", () => {
      expect(toCanonicalCustomModelList([{ modelId: "m", displayName: 42 }], "chat")).toEqual([
        { id: "m", label: "m", type: "chat" },
      ]);
    });
  });

  describe("given the two shapes mixed in one list", () => {
    it("reads both, because a customer may have written the list over time", () => {
      expect(toCanonicalCustomModelList(["a", { modelId: "b", displayName: "B" }], "chat")).toEqual(
        [
          { id: "a", label: "a", type: "chat" },
          { id: "b", label: "B", type: "chat" },
        ],
      );
    });
  });

  describe("given entries it cannot read", () => {
    it("drops them and keeps the rest, rather than failing the write", () => {
      expect(toCanonicalCustomModelList(["a", null, 7, {}, { modelId: 9 }, "b"], "chat")).toEqual([
        { id: "a", label: "a", type: "chat" },
        { id: "b", label: "b", type: "chat" },
      ]);
    });
  });

  describe("given the field was not sent at all", () => {
    it("answers undefined, which is not the same as an empty list", () => {
      // Undefined leaves the stored list alone; an empty array would clear it.
      expect(toCanonicalCustomModelList(undefined, "chat")).toBeUndefined();
      expect(toCanonicalCustomModelList(null, "chat")).toBeUndefined();
      expect(toCanonicalCustomModelList("not a list", "chat")).toBeUndefined();
      expect(toCanonicalCustomModelList([], "chat")).toEqual([]);
    });
  });

  describe("the type it stamps", () => {
    it("is the one the caller asked for, not one read from the entry", () => {
      expect(toCanonicalCustomModelList([{ modelId: "m", type: "chat" }], "embedding")).toEqual([
        { id: "m", label: "m", type: "embedding" },
      ]);
    });
  });
});
