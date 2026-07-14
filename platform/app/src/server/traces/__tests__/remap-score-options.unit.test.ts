import { describe, expect, it } from "vitest";
import { remapScoreOptionsToNames } from "../clickhouse-trace.service";

describe("remapScoreOptionsToNames", () => {
  describe("when score ids resolve to distinct names", () => {
    it("keys each value by its AnnotationScore name", () => {
      const remapped = remapScoreOptionsToNames(
        { "id-a": { value: "5" }, "id-b": { value: "low" } },
        new Map([
          ["id-a", "quality"],
          ["id-b", "toxicity"],
        ]),
      );
      expect(remapped).toEqual({
        quality: { value: "5" },
        toxicity: { value: "low" },
      });
    });
  });

  describe("when two score ids share the same name", () => {
    it("keeps the first under the plain name and id-suffixes the rest deterministically", () => {
      const remapped = remapScoreOptionsToNames(
        { "id-a": { value: "5" }, "id-b": { value: "3" } },
        new Map([
          ["id-a", "quality"],
          ["id-b", "quality"],
        ]),
      );
      expect(remapped).toEqual({
        quality: { value: "5" },
        "quality (id-b)": { value: "3" },
      });
    });
  });

  describe("when a score id has no definition", () => {
    it("keeps the id as the key so no data is lost", () => {
      const remapped = remapScoreOptionsToNames(
        { "id-unknown": { value: "1" } },
        new Map(),
      );
      expect(remapped).toEqual({ "id-unknown": { value: "1" } });
    });
  });
});
