/**
 * Both shapes a custom model list has ever been sent in.
 */

import { describe, expect, it } from "vitest";

import { toCanonicalCustomModelList } from "../custom-model-list.rules.ts";

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

  describe("given the per-model settings the custom-model form collects", () => {
    /** @scenario "A saved custom model keeps its max tokens, parameters and inputs" */
    it("keeps max tokens, supported parameters and multimodal inputs", () => {
      expect(
        toCanonicalCustomModelList(
          [
            {
              modelId: "acme-chat",
              displayName: "ACME Chat",
              mode: "chat",
              maxTokens: 8192,
              supportedParameters: ["temperature", "max_tokens"],
              multimodalInputs: ["image"],
            },
          ],
          "chat",
        ),
      ).toEqual([
        {
          id: "acme-chat",
          label: "ACME Chat",
          type: "chat",
          maxTokens: 8192,
          supportedParameters: ["temperature", "max_tokens"],
          multimodalInputs: ["image"],
        },
      ]);
    });

    it("keeps a cleared max tokens as null, so the save clears it", () => {
      expect(
        toCanonicalCustomModelList([{ modelId: "m", displayName: "M", maxTokens: null }], "chat"),
      ).toEqual([{ id: "m", label: "M", type: "chat", maxTokens: null }]);
    });

    /** @scenario "A custom model list without settings stores none" */
    it("adds no settings an entry did not carry", () => {
      expect(toCanonicalCustomModelList(["m", { modelId: "n" }], "chat")).toEqual([
        { id: "m", label: "m", type: "chat" },
        { id: "n", label: "n", type: "chat" },
      ]);
    });

    it("drops a setting of the wrong type rather than storing it", () => {
      expect(
        toCanonicalCustomModelList(
          [
            {
              modelId: "m",
              maxTokens: "lots",
              supportedParameters: "temperature",
              multimodalInputs: ["image", "video"],
            },
          ],
          "chat",
        ),
      ).toEqual([{ id: "m", label: "m", type: "chat" }]);
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

  describe("given the type it stamps", () => {
    it("is the one the caller asked for, not one read from the entry", () => {
      expect(toCanonicalCustomModelList([{ modelId: "m", type: "chat" }], "embedding")).toEqual([
        { id: "m", label: "m", type: "embedding" },
      ]);
    });
  });
});
