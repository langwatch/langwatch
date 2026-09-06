import { describe, expect, it } from "vitest";
import {
  readEvaluatorGroup,
  removeEvaluatorScoreRangeInQuery,
  setEvaluatorScoreRangeInQuery,
  toggleEvaluatorSubFilterInQuery,
} from "../evaluatorGroup";
import { parse } from "../parse";

const toggleVerdict = (currentQuery: string, value: string) =>
  toggleEvaluatorSubFilterInQuery({
    currentQuery,
    evaluatorId: "X",
    field: "evaluatorVerdict",
    value,
  });

const toggleLabel = (currentQuery: string, value: string) =>
  toggleEvaluatorSubFilterInQuery({
    currentQuery,
    evaluatorId: "X",
    field: "evaluatorLabel",
    value,
  });

describe("toggleEvaluatorSubFilterInQuery", () => {
  describe("given an empty query", () => {
    describe("when a verdict is toggled on", () => {
      it("emits the evaluator and verdict as one parenthesised group", () => {
        expect(toggleVerdict("", "pass")).toBe(
          "(evaluator:X AND evaluatorVerdict:pass)",
        );
      });

      it("produces a query that parses without error", () => {
        expect(() => parse(toggleVerdict("", "pass"))).not.toThrow();
      });
    });
  });

  describe("given a bare top-level evaluator filter", () => {
    describe("when a verdict is toggled on", () => {
      it("wraps the anchor and the verdict in the same group", () => {
        expect(toggleVerdict("evaluator:X", "pass")).toBe(
          "(evaluator:X AND evaluatorVerdict:pass)",
        );
      });
    });
  });

  describe("given an existing evaluator group with one verdict", () => {
    const base = "(evaluator:X AND evaluatorVerdict:pass)";

    describe("when a second verdict is toggled on", () => {
      it("adds it inside the same group", () => {
        expect(toggleVerdict(base, "fail")).toBe(
          "(evaluator:X AND evaluatorVerdict:pass AND evaluatorVerdict:fail)",
        );
      });
    });

    describe("when the same verdict is toggled again (include -> exclude)", () => {
      it("negates that sub-condition, keeping it in the group", () => {
        expect(toggleVerdict(base, "pass")).toBe(
          "(evaluator:X AND NOT evaluatorVerdict:pass)",
        );
      });
    });

    describe("when the verdict is toggled a third time (exclude -> neutral)", () => {
      it("drops the verdict and collapses the lone anchor out of parens", () => {
        const excluded = toggleVerdict(base, "pass");
        expect(toggleVerdict(excluded, "pass")).toBe("evaluator:X");
      });
    });
  });

  describe("given an unrelated top-level clause alongside the group", () => {
    describe("when a verdict is toggled on for the evaluator", () => {
      it("keeps the unrelated clause outside the evaluator's parens", () => {
        expect(toggleVerdict("status:error", "pass")).toBe(
          "status:error AND (evaluator:X AND evaluatorVerdict:pass)",
        );
      });
    });

    describe("when the verdict is later removed", () => {
      it("leaves the unrelated clause and the bare anchor", () => {
        const withVerdict = toggleVerdict("status:error", "pass");
        // include -> exclude -> neutral
        const excluded = toggleVerdict(withVerdict, "pass");
        expect(toggleVerdict(excluded, "pass")).toBe(
          "status:error AND evaluator:X",
        );
      });
    });
  });

  describe("given two different evaluators each carrying a verdict", () => {
    // Evaluator Y is anchored in its own group; toggling X must not touch it.
    const base =
      "(evaluator:Y AND evaluatorVerdict:fail) AND (evaluator:X AND evaluatorVerdict:pass)";

    describe("when evaluator X gains a label", () => {
      it("scopes the label to X's group and leaves Y untouched", () => {
        const out = toggleLabel(base, "toxic");
        const groupY = readEvaluatorGroup(out, "Y");
        const groupX = readEvaluatorGroup(out, "X");
        expect(groupY.categorical).toEqual([
          { field: "evaluatorVerdict", value: "fail", negated: false },
        ]);
        expect(groupX.categorical).toEqual([
          { field: "evaluatorVerdict", value: "pass", negated: false },
          { field: "evaluatorLabel", value: "toxic", negated: false },
        ]);
      });
    });
  });

  describe("given a label value with special characters", () => {
    it("quotes the value so the produced group parses", () => {
      const out = toggleLabel("", "needs review");
      expect(out).toBe('(evaluator:X AND evaluatorLabel:"needs review")');
      expect(() => parse(out)).not.toThrow();
    });
  });
});

describe("setEvaluatorScoreRangeInQuery", () => {
  describe("given an empty query", () => {
    it("emits the evaluator and score range as one group", () => {
      expect(
        setEvaluatorScoreRangeInQuery({
          currentQuery: "",
          evaluatorId: "X",
          from: "0",
          to: "0.5",
        }),
      ).toBe("(evaluator:X AND evaluatorScore:[0 TO 0.5])");
    });
  });

  describe("given a group that already has a verdict", () => {
    it("adds the score range alongside the verdict in the same group", () => {
      const out = setEvaluatorScoreRangeInQuery({
        currentQuery: "(evaluator:X AND evaluatorVerdict:pass)",
        evaluatorId: "X",
        from: "0.2",
        to: "0.8",
      });
      expect(out).toBe(
        "(evaluator:X AND evaluatorVerdict:pass AND evaluatorScore:[0.2 TO 0.8])",
      );
    });
  });

  describe("given a group that already has a score range", () => {
    it("replaces the old range rather than stacking a second one", () => {
      const out = setEvaluatorScoreRangeInQuery({
        currentQuery: "(evaluator:X AND evaluatorScore:[0 TO 1])",
        evaluatorId: "X",
        from: "0.4",
        to: "0.6",
      });
      expect(out).toBe("(evaluator:X AND evaluatorScore:[0.4 TO 0.6])");
    });
  });
});

describe("removeEvaluatorScoreRangeInQuery", () => {
  describe("given a group with a verdict and a score range", () => {
    it("clears just the score, keeping the verdict in the group", () => {
      const out = removeEvaluatorScoreRangeInQuery({
        currentQuery:
          "(evaluator:X AND evaluatorVerdict:pass AND evaluatorScore:[0 TO 0.5])",
        evaluatorId: "X",
      });
      expect(out).toBe("(evaluator:X AND evaluatorVerdict:pass)");
    });
  });

  describe("given a group whose only sub-condition is the score", () => {
    it("collapses to the bare anchor once the score clears", () => {
      const out = removeEvaluatorScoreRangeInQuery({
        currentQuery: "(evaluator:X AND evaluatorScore:[0 TO 0.5])",
        evaluatorId: "X",
      });
      expect(out).toBe("evaluator:X");
    });
  });
});

describe("readEvaluatorGroup", () => {
  describe("given a grouped evaluator with verdict, label, and score", () => {
    it("reads the scoped sub-conditions", () => {
      const group = readEvaluatorGroup(
        "(evaluator:X AND evaluatorVerdict:pass AND evaluatorLabel:toxic AND evaluatorScore:[0 TO 0.5])",
        "X",
      );
      expect(group.present).toBe(true);
      expect(group.categorical).toEqual([
        { field: "evaluatorVerdict", value: "pass", negated: false },
        { field: "evaluatorLabel", value: "toxic", negated: false },
      ]);
      expect(group.score).toEqual({ from: 0, to: 0.5 });
    });
  });

  describe("given a bare anchor with no group", () => {
    it("reports the anchor present but no sub-conditions", () => {
      const group = readEvaluatorGroup("evaluator:X AND status:error", "X");
      expect(group.present).toBe(true);
      expect(group.categorical).toEqual([]);
      expect(group.score).toBeNull();
    });
  });

  describe("given a query that never mentions the evaluator", () => {
    it("reports the anchor absent", () => {
      const group = readEvaluatorGroup("status:error", "X");
      expect(group.present).toBe(false);
    });
  });
});
