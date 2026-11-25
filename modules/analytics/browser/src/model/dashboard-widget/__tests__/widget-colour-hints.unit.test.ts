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
          column: 21,
          length: 9,
          hex: "#9f7aea",
          message: RAW_COLOUR_HINT_MESSAGE,
        },
      ]);
    });
  });

  describe("given widget code that reads LW.palette only", () => {
    /** @scenario "Source that reads LW.palette gets no colour hint" */
    it("raises no hint", () => {
      expect(rawColourHints(`const RAMP = LW.palette.series;`)).toEqual([]);
    });
  });

  describe("given CSS written unquoted inside a template string", () => {
    it("does not hint it, since only string literals are colours the author chose", () => {
      expect(rawColourHints("outline: 2px solid #0d9488;")).toEqual([]);
    });
  });
});
