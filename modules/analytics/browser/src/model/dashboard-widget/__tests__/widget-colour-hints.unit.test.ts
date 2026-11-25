import { describe, expect, it } from "vitest";

import { RAW_COLOUR_HINT_MESSAGE, rawColourHints } from "../widget-colour-hints.ts";

describe("rawColourHints", () => {
  describe("given widget code with a quoted hex colour", () => {
    const source = `const C = 1;\nconst colours = [C, "#9f7aea"];`;

    /** @scenario "A quoted hex colour is hinted" */
    it("hints the hex with its line, column and the palette message", () => {
      expect(rawColourHints(source)).toEqual([
        {
          line: 2,
          column: 22,
          length: 7,
          colour: "#9f7aea",
          message: RAW_COLOUR_HINT_MESSAGE,
        },
      ]);
    });
  });

  describe("given a hex colour inside a longer string or template literal", () => {
    /** @scenario "A hex colour inside a longer string is hinted" */
    it("hints each hex and skips the text around it", () => {
      const source = `const border = "1px solid #e4e4e7";\nconst tone = \`\${x} #9f7aea\`;`;
      expect(rawColourHints(source).map((hint) => [hint.line, hint.colour])).toEqual([
        [1, "#e4e4e7"],
        [2, "#9f7aea"],
      ]);
    });
  });

  describe("given hex-like tokens of each length", () => {
    it("hints 3, 4, 6 and 8 digit colours only", () => {
      const hexes = ["#abc", "#abcd", "#aabbcc", "#aabbccdd"];
      const hinted = rawColourHints(hexes.map((hex) => `"${hex}"`).join("\n"));
      expect(hinted.map((hint) => hint.colour)).toEqual(hexes);
    });

    it("ignores 5 and 7 digit tokens and a hex run on into a word", () => {
      expect(rawColourHints(`"#12345" "#1234567" "#abcdefg"`)).toEqual([]);
    });
  });

  describe("given a hex colour inside a comment", () => {
    /** @scenario "Hex colours in comments are not hinted" */
    it("skips // line comments and block comments", () => {
      const source = `// "#9f7aea"\n/* "#e4e4e7"\n "#0d9488" */\nconst x = 1;`;
      expect(rawColourHints(source)).toEqual([]);
    });
  });

  describe("given an apostrophe in JSX text above a hex colour", () => {
    it("still hints the colour on the next line", () => {
      const source = `<p>Don't read this</p>\nconst c = "#9f7aea";`;
      expect(rawColourHints(source).map((hint) => [hint.line, hint.colour])).toEqual([
        [2, "#9f7aea"],
      ]);
    });
  });

  describe("given widget code that reads LW.palette only", () => {
    /** @scenario "Source that reads LW.palette gets no colour hint" */
    it("raises no hint", () => {
      expect(rawColourHints(`const RAMP = LW.palette.series;`)).toEqual([]);
    });
  });

  describe("given a colour function inside a string", () => {
    /** @scenario "A colour function inside a string is hinted" */
    it("hints rgb() and hsl() calls", () => {
      const source = `const a = "rgb(0, 0, 0)";\nconst b = "hsl(0 0% 0%)";`;
      expect(rawColourHints(source).map((hint) => [hint.line, hint.colour])).toEqual([
        [1, "rgb(0, 0, 0)"],
        [2, "hsl(0 0% 0%)"],
      ]);
    });
  });

  describe("given white or black as a string or a border style", () => {
    /** @scenario "A white or black colour in a string is hinted" */
    it("hints the named colour at its opening quote", () => {
      const source = `const a = "white";\nconst b = "1px solid black";`;
      const hints = rawColourHints(source);
      expect(hints.map((hint) => [hint.line, hint.column, hint.colour])).toEqual([
        [1, 11, "white"],
        [2, 11, "1px solid black"],
      ]);
    });
  });

  describe("given text that merely contains white or black", () => {
    /** @scenario "Text that merely contains white or black is not hinted" */
    it("raises no hint", () => {
      expect(rawColourHints(`const a = "Black box"; const b = "a white space";`)).toEqual([]);
    });
  });

  describe("given CSS written unquoted inside a template string", () => {
    it("does not hint it, since only string literals are colours the author chose", () => {
      expect(rawColourHints("outline: 2px solid #0d9488;")).toEqual([]);
    });
  });
});
