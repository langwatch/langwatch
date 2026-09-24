import { beforeEach, describe, expect, it } from "vitest";
import { analyzeOrGroups } from "~/server/app-layer/traces/query-language/queries";
import { useExplorerStore } from "../explorerStore";

const TRANSLATION = {
  projectId: "proj_test",
  prompt: "show me errors today",
  query: "status:error",
};

beforeEach(() => {
  // Each test starts from a clean store. `clearAll` resets the
  // queryText, AST, page, AND `lastAiTranslation` (the latter is one
  // of the lifecycle paths under test).
  useExplorerStore.getState().clearAll();
});

describe("toggleFacet", () => {
  describe("given an existing query and a neutral state with no orGroupLocation", () => {
    describe("when called", () => {
      it("AND-appends the new clause", () => {
        useExplorerStore.getState().applyQueryText("model:gpt-4o");
        useExplorerStore.getState().toggleFacet("status", "error");
        expect(useExplorerStore.getState().queryText).toBe(
          "model:gpt-4o AND status:error",
        );
      });
    });
  });

  describe("given an existing query and combinator: OR", () => {
    describe("when called", () => {
      it("wraps both sides in parens and joins with OR", () => {
        // Store-level contract: `combinator: "OR"` opens a fresh
        // top-level OR scope. OR has lower precedence than AND, so the
        // toggle wraps both sides to preserve intent. (Cross-field OR is
        // built by typing in the filter bar — no sidebar click produces
        // this combinator any more — but the store mechanism stays.)
        useExplorerStore.getState().applyQueryText("model:gpt-4o");
        useExplorerStore
          .getState()
          .toggleFacet("status", "error", { combinator: "OR" });
        expect(useExplorerStore.getState().queryText).toBe(
          "(model:gpt-4o) OR (status:error)",
        );
      });
    });
  });

  describe("given a query with an existing OR group and a neutral state", () => {
    describe("when called with orGroupLocation pointing at the group", () => {
      it("splices the new value into the existing group instead of appending", () => {
        useExplorerStore
          .getState()
          .applyQueryText("status:error OR model:gpt-4o");
        const query = useExplorerStore.getState().queryText;
        useExplorerStore.getState().toggleFacet("origin", "application", {
          orGroupLocation: { start: 0, end: query.length },
        });
        expect(useExplorerStore.getState().queryText).toBe(
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
        useExplorerStore
          .getState()
          .applyQueryText("status:error OR model:gpt-4o");
        useExplorerStore.getState().toggleFacet("status", "error", {
          orGroupLocation: { start: 0, end: 28 },
        });
        expect(useExplorerStore.getState().queryText).toContain(
          "NOT status:error",
        );
      });
    });
  });

  describe("given the field already has one bare value", () => {
    describe("when a second value of the SAME field is added on a plain click", () => {
      /** @scenario "A second same-field value OR-combines on a plain click" */
      it("OR-combines the two values into a parenthesised group", () => {
        // The bug fix: same-field multi-select must OR, not AND — a
        // trace's origin can't be both `sample` and `application`.
        useExplorerStore.getState().applyQueryText("origin:sample");
        useExplorerStore.getState().toggleFacet("origin", "application");
        expect(useExplorerStore.getState().queryText).toBe(
          "(origin:sample OR origin:application)",
        );
      });
    });

    describe("when the field's lone value sits beside a cross-field AND", () => {
      /** @scenario "A same-field OR alongside another facet stays parenthesised" */
      it("scopes the same-field OR under the AND with parens", () => {
        // Precedence guard: `model:x AND origin:a OR origin:b` would bind
        // as `(model:x AND origin:a) OR origin:b` — the parens keep the
        // OR scoped to the origin field.
        useExplorerStore
          .getState()
          .applyQueryText("model:gpt-4o AND origin:sample");
        useExplorerStore.getState().toggleFacet("origin", "application");
        expect(useExplorerStore.getState().queryText).toBe(
          "model:gpt-4o AND (origin:sample OR origin:application)",
        );
      });
    });

    describe("when a value in a DIFFERENT field is added", () => {
      /** @scenario "A value in a different facet AND-combines" */
      it("AND-combines — a different field narrows rather than ORs", () => {
        useExplorerStore.getState().applyQueryText("origin:sample");
        useExplorerStore.getState().toggleFacet("status", "error");
        expect(useExplorerStore.getState().queryText).toBe(
          "origin:sample AND status:error",
        );
      });
    });
  });

  describe("given a same-field OR group already exists", () => {
    describe("when a third value is added with the group's orGroupLocation", () => {
      it("extends the existing group rather than nesting a new one", () => {
        // Mirror production: the location comes from `analyzeOrGroups`,
        // which reports the INNER OR expression's span (inside the
        // parens), so the splice lands before the closing `)`.
        useExplorerStore
          .getState()
          .applyQueryText("(origin:sample OR origin:application)");
        const { ast } = useExplorerStore.getState();
        const group = analyzeOrGroups(ast).groups[0]!;
        useExplorerStore.getState().toggleFacet("origin", "api", {
          orGroupLocation: { start: group.start, end: group.end },
        });
        expect(useExplorerStore.getState().queryText).toBe(
          "(origin:sample OR origin:application OR origin:api)",
        );
      });
    });

    describe("when a value is removed (2 → 1)", () => {
      /** @scenario "Unchecking down to one value collapses the OR group to a bare clause" */
      it("collapses the group back to a bare tag", () => {
        useExplorerStore
          .getState()
          .applyQueryText("(origin:sample OR origin:application)");
        useExplorerStore.getState().removeFacet("origin", "application");
        expect(useExplorerStore.getState().queryText).toBe("origin:sample");
      });
    });
  });
});

describe("excludeFacet", () => {
  describe("given a neutral value", () => {
    describe("when excluded", () => {
      it("adds a NOT clause", () => {
        useExplorerStore.getState().excludeFacet("status", "error");
        expect(useExplorerStore.getState().queryText).toBe("NOT status:error");
      });
    });
  });

  describe("given an already-included value", () => {
    describe("when excluded", () => {
      it("flips the include to a NOT clause", () => {
        useExplorerStore.getState().applyQueryText("status:error");
        useExplorerStore.getState().excludeFacet("status", "error");
        expect(useExplorerStore.getState().queryText).toBe("NOT status:error");
      });
    });
  });

  describe("given an already-excluded value", () => {
    describe("when excluded again", () => {
      it("toggles back to neutral", () => {
        useExplorerStore.getState().applyQueryText("NOT status:error");
        useExplorerStore.getState().excludeFacet("status", "error");
        expect(useExplorerStore.getState().queryText).toBe("");
      });
    });
  });

  describe("given another field is already filtered", () => {
    describe("when a value is excluded", () => {
      it("AND-combines the NOT clause", () => {
        useExplorerStore.getState().applyQueryText("model:gpt-4o");
        useExplorerStore.getState().excludeFacet("status", "error");
        expect(useExplorerStore.getState().queryText).toBe(
          "model:gpt-4o AND NOT status:error",
        );
      });
    });
  });
});

describe("recordAiTranslation", () => {
  describe("when called", () => {
    it("stores the translation verbatim", () => {
      useExplorerStore.getState().recordAiTranslation(TRANSLATION);
      expect(useExplorerStore.getState().lastAiTranslation).toEqual(
        TRANSLATION,
      );
    });
  });
});

describe("lastAiTranslation lifecycle", () => {
  describe("given a recorded translation", () => {
    beforeEach(() => {
      useExplorerStore.getState().recordAiTranslation(TRANSLATION);
    });

    describe("when toggleFacet runs", () => {
      it("clears the translation", () => {
        useExplorerStore.getState().toggleFacet("status", "error");
        expect(useExplorerStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when swapOperator runs", () => {
      it("clears the translation", () => {
        useExplorerStore
          .getState()
          .applyQueryText("status:error AND model:gpt-4o");
        useExplorerStore.getState().recordAiTranslation(TRANSLATION); // re-set after applyQueryText cleared it
        // AND lives at offsets 13..16 in the trimmed string.
        useExplorerStore.getState().swapOperator(13, 16);
        expect(useExplorerStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when setFacetValueAt runs", () => {
      it("clears the translation", () => {
        useExplorerStore.getState().applyQueryText("status:error");
        useExplorerStore.getState().recordAiTranslation(TRANSLATION);
        // Tag.location for `status:error` is 0..12.
        useExplorerStore.getState().setFacetValueAt(0, 12, "warning");
        expect(useExplorerStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when removeFacet runs", () => {
      it("clears the translation", () => {
        useExplorerStore.getState().applyQueryText("status:error");
        useExplorerStore.getState().recordAiTranslation(TRANSLATION);
        useExplorerStore.getState().removeFacet("status", "error");
        expect(useExplorerStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when clearAll runs", () => {
      it("clears the translation", () => {
        useExplorerStore.getState().clearAll();
        expect(useExplorerStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when applyQueryText runs with a non-AI mutation", () => {
      it("clears the translation", () => {
        useExplorerStore.getState().applyQueryText("model:gpt-4o");
        expect(useExplorerStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when setFilterFromLens runs", () => {
      it("clears the translation", () => {
        useExplorerStore.getState().setFilterFromLens("status:error");
        expect(useExplorerStore.getState().lastAiTranslation).toBeNull();
      });
    });

    describe("when setQuery runs", () => {
      it("clears the translation", () => {
        useExplorerStore.getState().applyQueryText("status:error");
        useExplorerStore.getState().recordAiTranslation(TRANSLATION); // re-set after applyQueryText cleared it
        const { ast } = useExplorerStore.getState();
        useExplorerStore.getState().setQuery("status:error", ast);
        expect(useExplorerStore.getState().lastAiTranslation).toBeNull();
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
        useExplorerStore.getState().applyQueryText("status:error");
        useExplorerStore.getState().recordAiTranslation(TRANSLATION);
        useExplorerStore.getState().applyQueryText("status:error");
        expect(useExplorerStore.getState().lastAiTranslation).toEqual(
          TRANSLATION,
        );
      });
    });
  });
});
