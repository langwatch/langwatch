import { beforeEach, describe, expect, it } from "vitest";
import { useFilterStore } from "../filterStore";

const TRANSLATION = {
  projectId: "proj_test",
  prompt: "show me errors today",
  query: "status:error",
};

beforeEach(() => {
  // Each test starts from a clean store. `clearAll` resets the
  // queryText, AST, page, AND `lastAiTranslation` (the latter is one of
  // the lifecycle paths under test).
  useFilterStore.getState().clearAll();
});

describe("toggleFacet", () => {
  describe("given a neutral state without orGroupLocation", () => {
    it("appends with AND when the query has existing content", () => {
      useFilterStore.getState().applyQueryText("model:gpt-4o");
      useFilterStore.getState().toggleFacet("status", "error");
      expect(useFilterStore.getState().queryText).toBe(
        "model:gpt-4o AND status:error",
      );
    });
  });

  describe("given a neutral state with combinator: OR", () => {
    it("wraps both sides in parens and joins with OR", () => {
      // OR has lower precedence than AND, so the toggle wraps to
      // preserve user intent regardless of how the existing query was
      // built.
      useFilterStore.getState().applyQueryText("model:gpt-4o");
      useFilterStore
        .getState()
        .toggleFacet("status", "error", { combinator: "OR" });
      expect(useFilterStore.getState().queryText).toBe(
        "(model:gpt-4o) OR (status:error)",
      );
    });
  });

  describe("given a neutral state with orGroupLocation", () => {
    it("splices the new value into the existing OR group instead of appending", () => {
      useFilterStore.getState().applyQueryText("status:error OR model:gpt-4o");
      // The OR group's location in liqe trimmed coords spans the whole
      // top-level expression: 0..28 (for "status:error OR model:gpt-4o").
      const query = useFilterStore.getState().queryText;
      useFilterStore.getState().toggleFacet("origin", "application", {
        orGroupLocation: { start: 0, end: query.length },
      });
      expect(useFilterStore.getState().queryText).toBe(
        "status:error OR model:gpt-4o OR origin:application",
      );
    });

    it("falls through to the generic toggle when the value is already in the query (state != neutral)", () => {
      // `status:error` is already an include — toggling cycles to
      // exclude via the standard toggleFacetInQuery path, NOT the
      // splice path. The orGroupLocation hint is ignored on
      // include/exclude transitions.
      useFilterStore.getState().applyQueryText("status:error OR model:gpt-4o");
      useFilterStore.getState().toggleFacet("status", "error", {
        orGroupLocation: { start: 0, end: 28 },
      });
      // Cycle: include → exclude rewrites the value as NOT.
      expect(useFilterStore.getState().queryText).toContain("NOT status:error");
    });
  });
});

describe("lastAiTranslation lifecycle", () => {
  describe("recordAiTranslation", () => {
    it("stores the translation verbatim", () => {
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      expect(useFilterStore.getState().lastAiTranslation).toEqual(TRANSLATION);
    });
  });

  describe("clearing on mutations", () => {
    it("clears on toggleFacet", () => {
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      useFilterStore.getState().toggleFacet("status", "error");
      expect(useFilterStore.getState().lastAiTranslation).toBeNull();
    });

    it("clears on swapOperator", () => {
      useFilterStore
        .getState()
        .applyQueryText("status:error AND model:gpt-4o");
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      // AND lives at offsets 13..16 in the trimmed string.
      useFilterStore.getState().swapOperator(13, 16);
      expect(useFilterStore.getState().lastAiTranslation).toBeNull();
    });

    it("clears on setFacetValueAt", () => {
      useFilterStore.getState().applyQueryText("status:error");
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      // Tag.location for `status:error` is 0..12.
      useFilterStore.getState().setFacetValueAt(0, 12, "warning");
      expect(useFilterStore.getState().lastAiTranslation).toBeNull();
    });

    it("clears on removeFacet", () => {
      useFilterStore.getState().applyQueryText("status:error");
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      useFilterStore.getState().removeFacet("status", "error");
      expect(useFilterStore.getState().lastAiTranslation).toBeNull();
    });

    it("clears on clearAll", () => {
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      useFilterStore.getState().clearAll();
      expect(useFilterStore.getState().lastAiTranslation).toBeNull();
    });

    it("clears on applyQueryText with a non-AI mutation", () => {
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      useFilterStore.getState().applyQueryText("model:gpt-4o");
      expect(useFilterStore.getState().lastAiTranslation).toBeNull();
    });

    it("clears on setFilterFromLens", () => {
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      useFilterStore.getState().setFilterFromLens("status:error");
      expect(useFilterStore.getState().lastAiTranslation).toBeNull();
    });

    it("clears on setQuery", () => {
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      // setQuery's signature: (text, ast). We re-use applyQueryText to
      // get a parsed AST, then call setQuery with the same shape.
      useFilterStore.getState().applyQueryText("status:error");
      useFilterStore.getState().recordAiTranslation(TRANSLATION); // re-set after applyQueryText cleared it
      const { ast } = useFilterStore.getState();
      useFilterStore.getState().setQuery("status:error", ast);
      expect(useFilterStore.getState().lastAiTranslation).toBeNull();
    });
  });

  describe("when applyQueryText is a no-op (same text, no parse error)", () => {
    it("does NOT clear the translation — the call is a true no-op", () => {
      // The store short-circuits when canonical text matches and there
      // was no prior parse error. This is what lets the AI flow
      // `recordAiTranslation` immediately after `applyQueryText` and
      // still have the translation stick on subsequent re-renders.
      useFilterStore.getState().applyQueryText("status:error");
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      // Re-applying the same text should leave the translation intact.
      useFilterStore.getState().applyQueryText("status:error");
      expect(useFilterStore.getState().lastAiTranslation).toEqual(TRANSLATION);
    });
  });
});
