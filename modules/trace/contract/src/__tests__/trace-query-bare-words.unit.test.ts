/**
 * The bare-word split behind Enter, the phrase form the fix restores, and the
 * node ceiling the client checks. Spec: specs/traces-v2/search.feature
 */
import { describe, expect, it } from "vitest";

import {
  countFilterNodes,
  FILTER_TOO_COMPLEX_MESSAGE,
  MAX_FILTER_NODE_COUNT,
  describeAstProblem,
} from "../trace-query-analysis.ts";
import {
  combineQueries,
  quoteAsPhrase,
  requoteBareTerms,
  splitBareWords,
} from "../trace-query-mutations.ts";
import { parse } from "../trace-query-parser.ts";

const words = (count: number): string =>
  Array.from({ length: count }, (_, index) => `word${index}`).join(" ");

describe("splitBareWords", () => {
  describe("given only field:value terms", () => {
    it("has no sentence and keeps the query as typed", () => {
      expect(splitBareWords("status:error AND model:gpt-5-mini")).toEqual({
        sentence: "",
        explicitQuery: "status:error AND model:gpt-5-mini",
      });
    });
  });

  describe("given bare words next to explicit terms", () => {
    /** @scenario "Explicit terms typed next to a sentence are kept" */
    it("joins the words in order and keeps the explicit terms", () => {
      expect(splitBareWords("annoyed users status:error asking refunds")).toEqual({
        sentence: "annoyed users asking refunds",
        explicitQuery: "status:error",
      });
    });
  });

  describe("given a quoted phrase", () => {
    it("treats it as explicit: the writer already chose phrase search", () => {
      expect(splitBareWords('"refund policy" status:error')).toEqual({
        sentence: "",
        explicitQuery: '"refund policy" status:error',
      });
    });
  });

  describe("given a negated bare word", () => {
    it("keeps the negation as a filter rather than a word of the sentence", () => {
      expect(splitBareWords("refund -timeout")).toEqual({
        sentence: "refund",
        explicitQuery: "-timeout",
      });
    });
  });

  describe("given a bare word under an OR", () => {
    /** @scenario "A word under an OR stays in the explicit query" */
    it("keeps it explicit, because the two halves are rejoined with AND", () => {
      expect(splitBareWords("status:error OR refund")).toEqual({
        sentence: "",
        explicitQuery: "status:error OR refund",
      });
    });

    it("keeps a word under an OR nested inside a group explicit too", () => {
      expect(splitBareWords("model:gpt-5-mini AND (status:error OR refund)")).toEqual({
        sentence: "",
        explicitQuery: "model:gpt-5-mini AND (status:error OR refund)",
      });
    });

    it("still lifts the words that sit in conjunction-only positions", () => {
      expect(splitBareWords("annoyed AND (status:error OR status:ok)")).toEqual({
        sentence: "annoyed",
        explicitQuery: "(status:error OR status:ok)",
      });
    });
  });

  describe("given text that does not parse", () => {
    it("has no sentence, so the parse error surfaces where it always did", () => {
      expect(splitBareWords('status:"unclosed')).toEqual({
        sentence: "",
        explicitQuery: 'status:"unclosed',
      });
    });
  });
});

describe("quoteAsPhrase", () => {
  it("quotes several words as one phrase and leaves one safe word bare", () => {
    expect(quoteAsPhrase("annoyed  users")).toBe('"annoyed users"');
    expect(quoteAsPhrase("refund")).toBe("refund");
    expect(quoteAsPhrase("   ")).toBe("");
  });
});

describe("combineQueries", () => {
  it("returns the other side when one is empty", () => {
    expect(combineQueries({ base: "", addition: "status:error" })).toBe("status:error");
    expect(combineQueries({ base: "status:error", addition: "" })).toBe("status:error");
  });

  it("parenthesises a side carrying OR so AND cannot rebind it", () => {
    expect(
      combineQueries({ base: "status:error", addition: "model:gpt-5-mini OR model:claude" }),
    ).toBe("status:error AND (model:gpt-5-mini OR model:claude)");
  });

  describe("when a side starts and ends with a parenthesis without being one group", () => {
    /** @scenario "Joining a query that holds a top-level OR groups it first" */
    it("groups it, so the OR keeps both of its own operands", () => {
      expect(combineQueries({ base: "(status:error) OR (status:ok)", addition: "c" })).toBe(
        "((status:error) OR (status:ok)) AND c",
      );
    });

    it("leaves a query that really is one group alone", () => {
      expect(combineQueries({ base: "(status:error OR status:ok)", addition: "c" })).toBe(
        "(status:error OR status:ok) AND c",
      );
    });
  });
});

describe("requoteBareTerms", () => {
  describe("given a sentence past the term ceiling", () => {
    /** @scenario "The fix quotes the sentence as one phrase" */
    it("collapses the words into one phrase and keeps the explicit terms", () => {
      const sentence = words(12);

      expect(requoteBareTerms(`status:error ${sentence}`)).toBe(`status:error AND "${sentence}"`);
    });

    it("produces a query under the ceiling", () => {
      expect(describeAstProblem(parse(requoteBareTerms(words(30))))).toBeNull();
    });
  });

  describe("given no bare words", () => {
    it("returns the query untouched", () => {
      expect(requoteBareTerms("status:error AND model:gpt-5-mini")).toBe(
        "status:error AND model:gpt-5-mini",
      );
    });
  });
});

describe("describeAstProblem node ceiling", () => {
  describe("given eleven bare words", () => {
    /** @scenario "The client refuses a sentence past the term ceiling before sending it" */
    it("refuses with the same copy the server answers with", () => {
      const ast = parse(words(11));

      expect(countFilterNodes(ast)).toBe(21);
      expect(countFilterNodes(ast)).toBeGreaterThan(MAX_FILTER_NODE_COUNT);
      expect(describeAstProblem(ast)).toBe(FILTER_TOO_COMPLEX_MESSAGE);
    });
  });

  describe("given ten bare words", () => {
    it("passes: nineteen nodes is under the ceiling", () => {
      expect(describeAstProblem(parse(words(10)))).toBeNull();
    });
  });

  describe("given the same sentence quoted", () => {
    it("is one node and passes", () => {
      expect(describeAstProblem(parse(`"${words(11)}"`))).toBeNull();
    });
  });
});
