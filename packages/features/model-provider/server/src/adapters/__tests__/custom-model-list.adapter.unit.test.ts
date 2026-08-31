/**
 * Both shapes a custom model list has ever been sent in.
 *
 * The field started as an array of model-id strings and later took
 * `{ modelId, displayName }` objects. Both are still accepted, and this used
 * to be read by two byte-identical copies — one in the REST write, one in the
 * tRPC write — so the same request could come to be read differently
 * depending on which door it arrived through. There is one reader now, and
 * these pin what it accepts.
 *
 * The drop-rather-than-refuse rule is the other half: a custom model list is a
 * convenience field on an otherwise valid provider write, so a malformed entry
 * costs that entry and not the write.
 */

import { describe, expect, it } from "vitest";
import { CustomModelList } from "../custom-model-list.adapter";

describe("CustomModelList.toCanonical", () => {
  describe("given the string shape the field started as", () => {
    it("reads each id as its own label", () => {
      expect(CustomModelList.toCanonical(["gpt-5-mini"], "chat")).toEqual([
        { id: "gpt-5-mini", label: "gpt-5-mini", type: "chat" },
      ]);
    });
  });

  describe("given the object shape it takes now", () => {
    it("reads the display name as the label", () => {
      expect(
        CustomModelList.toCanonical([{ modelId: "gpt-5-mini", displayName: "Fast" }], "chat"),
      ).toEqual([{ id: "gpt-5-mini", label: "Fast", type: "chat" }]);
    });

    it("falls back to the id when no display name was given", () => {
      expect(CustomModelList.toCanonical([{ modelId: "gpt-5-mini" }], "embedding")).toEqual([
        { id: "gpt-5-mini", label: "gpt-5-mini", type: "embedding" },
      ]);
    });

    it("ignores a display name that is not text", () => {
      expect(CustomModelList.toCanonical([{ modelId: "m", displayName: 42 }], "chat")).toEqual([
        { id: "m", label: "m", type: "chat" },
      ]);
    });
  });

  describe("given the two shapes mixed in one list", () => {
    it("reads both, because a customer may have written the list over time", () => {
      expect(
        CustomModelList.toCanonical(["a", { modelId: "b", displayName: "B" }], "chat"),
      ).toEqual([
        { id: "a", label: "a", type: "chat" },
        { id: "b", label: "B", type: "chat" },
      ]);
    });
  });

  describe("given entries it cannot read", () => {
    it("drops them and keeps the rest, rather than failing the write", () => {
      expect(CustomModelList.toCanonical(["a", null, 7, {}, { modelId: 9 }, "b"], "chat")).toEqual([
        { id: "a", label: "a", type: "chat" },
        { id: "b", label: "b", type: "chat" },
      ]);
    });
  });

  describe("given the field was not sent at all", () => {
    it("answers undefined, which is not the same as an empty list", () => {
      // Undefined leaves the stored list alone; an empty array would clear it.
      expect(CustomModelList.toCanonical(undefined, "chat")).toBeUndefined();
      expect(CustomModelList.toCanonical(null, "chat")).toBeUndefined();
      expect(CustomModelList.toCanonical("not a list", "chat")).toBeUndefined();
      expect(CustomModelList.toCanonical([], "chat")).toEqual([]);
    });
  });

  describe("the type it stamps", () => {
    it("is the one the caller asked for, not one read from the entry", () => {
      expect(CustomModelList.toCanonical([{ modelId: "m", type: "chat" }], "embedding")).toEqual([
        { id: "m", label: "m", type: "embedding" },
      ]);
    });
  });
});
