import { beforeEach, describe, expect, it } from "vitest";
import { useFilterStore } from "../filterStore";

const TRANSLATION = {
  projectId: "proj_test",
  prompt: "show me errors today",
  query: "status:error",
};

beforeEach(() => {
  // Each test starts from a clean store. `clearAll` resets the
  // queryText, AST, page, AND `lastAiTranslation` (the latter is one
  // of the lifecycle paths under test).
  useFilterStore.getState().clearAll();
});

describe("toggleFacet", () => {
  describe("given an existing query and a neutral state with no orGroupLocation", () => {
    describe("when called", () => {
      it("AND-appends the new clause", () => {
        useFilterStore.getState().applyQueryText("model:gpt-4o");
        useFilterStore.getState().toggleFacet("status", "error");
        expect(useFilterStore.getState().queryText).toBe(
          "model:gpt-4o AND status:error",
        );
      });
    });
  });

  describe("given an existing query and combinator: OR", () => {
    describe("when called", () => {
      it("wraps both sides in parens and joins with OR", () => {
        // OR has lower precedence than AND, so the toggle wraps to
        // preserve user intent regardless of how the existing query
        // was built.
        useFilterStore.getState().applyQueryText("model:gpt-4o");
        useFilterStore
          .getState()
          .toggleFacet("status", "error", { combinator: "OR" });
        expect(useFilterStore.getState().queryText).toBe(
          "(model:gpt-4o) OR (status:error)",
        );
      });
    });
  });

  describe("given a query with an existing OR group and a neutral state", () => {
    describe("when called with orGroupLocation pointing at the group", () => {
      it("splices the new value into the existing group instead of appending", () => {
        useFilterStore
          .getState()
          .applyQueryText("status:error OR model:gpt-4o");
        const query = useFilterStore.getState().queryText;
        useFilterStore.getState().toggleFacet("origin", "application", {
          orGroupLocation: { start: 0, end: query.length },
        });
        expect(useFilterStore.getState().queryText).toBe(
          "status:error OR model:gpt-4o OR origin:application",
        );
      });
    });
  });

  describe("given a value already in the query (state != neutral)", () => {
    describe("when called with orGroupLocation", () => {
      it("ignores the splice hint and falls through to the standard toggle cycle", () => {
        // `status:error` is already an include — toggling cycles to
        // exclude via the standard toggleFacetInQuery path, NOT the
        // splice path. The orGroupLocation hint is ignored.
        useFilterStore
          .getState()
          .applyQueryText("status:error OR model:gpt-4o");
        useFilterStore.getState().toggleFacet("status", "error", {
          orGroupLocation: { start: 0, end: 28 },
        });
        expect(useFilterStore.getState().queryText).toContain(
          "NOT status:error",
        );
      });
    });
  });
});

describe("recordAiTranslation", () => {
  describe("when called", () => {
    it("stores the translation verbatim", () => {
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
      expect(useFilterStore.getState().lastAiTranslation).toEqual(TRANSLATION);
    });
  });
});

describe("lastAiTranslation lifecycle", () => {
  describe("given a recorded translation", () => {
    beforeEach(() => {
      useFilterStore.getState().recordAiTranslation(TRANSLATION);
    });

    describe("when toggleFacet runs", () => {
      it("clears the translation", () => {
        useFilterStore.getState().toggleFacet("status", "error");
        expect(useFilterStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when swapOperator runs", () => {
      it("clears the translation", () => {
        useFilterStore
          .getState()
          .applyQueryText("status:error AND model:gpt-4o");
        useFilterStore.getState().recordAiTranslation(TRANSLATION); // re-set after applyQueryText cleared it
        // AND lives at offsets 13..16 in the trimmed string.
        useFilterStore.getState().swapOperator(13, 16);
        expect(useFilterStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when setFacetValueAt runs", () => {
      it("clears the translation", () => {
        useFilterStore.getState().applyQueryText("status:error");
        useFilterStore.getState().recordAiTranslation(TRANSLATION);
        // Tag.location for `status:error` is 0..12.
        useFilterStore.getState().setFacetValueAt(0, 12, "warning");
        expect(useFilterStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when removeFacet runs", () => {
      it("clears the translation", () => {
        useFilterStore.getState().applyQueryText("status:error");
        useFilterStore.getState().recordAiTranslation(TRANSLATION);
        useFilterStore.getState().removeFacet("status", "error");
        expect(useFilterStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when clearAll runs", () => {
      it("clears the translation", () => {
        useFilterStore.getState().clearAll();
        expect(useFilterStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when applyQueryText runs with a non-AI mutation", () => {
      it("clears the translation", () => {
        useFilterStore.getState().applyQueryText("model:gpt-4o");
        expect(useFilterStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when setFilterFromLens runs", () => {
      it("clears the translation", () => {
        useFilterStore.getState().setFilterFromLens("status:error");
        expect(useFilterStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when setQuery runs", () => {
      it("clears the translation", () => {
        useFilterStore.getState().applyQueryText("status:error");
        useFilterStore.getState().recordAiTranslation(TRANSLATION); // re-set after applyQueryText cleared it
        const { ast } = useFilterStore.getState();
        useFilterStore.getState().setQuery("status:error", ast);
        expect(useFilterStore.getState().lastAiTranslation).toBeNull();
      });
    });
  });

  describe("given a recorded translation matching the current query", () => {
    describe("when applyQueryText is called with the same text", () => {
      it("preserves the translation — the call is a true no-op", () => {
        // The store short-circuits when canonical text matches and
        // there was no prior parse error. This is what lets the AI
        // flow `recordAiTranslation` immediately after `applyQueryText`
        // and still have the translation stick on subsequent re-renders.
        useFilterStore.getState().applyQueryText("status:error");
        useFilterStore.getState().recordAiTranslation(TRANSLATION);
        useFilterStore.getState().applyQueryText("status:error");
        expect(useFilterStore.getState().lastAiTranslation).toEqual(
          TRANSLATION,
        );
      });
    });
  });
});
