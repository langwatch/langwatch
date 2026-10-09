/**
 * @see ../goose.migration-runner.ts
 * @see ../../../../specs/upgrade/stepping.feature
 */
import { describe, expect, it } from "vitest";

import { goosePasses } from "../goose.migration-runner";

describe("goosePasses()", () => {
  describe("when no stopping version is given", () => {
    /** @scenario "Without a stopping version goose runs exactly as before" */
    it("replays up to 86 with the compatibility, then runs up, as before", () => {
      expect(goosePasses({ requiresDimensionCompat: true, upTo: undefined })).toEqual([
        { command: ["up-to", "86"], allowDimensionsOutsideSortingKey: true },
        { command: ["up"], allowDimensionsOutsideSortingKey: false },
      ]);
      expect(goosePasses({ requiresDimensionCompat: false, upTo: undefined })).toEqual([
        { command: ["up"], allowDimensionsOutsideSortingKey: false },
      ]);
    });
  });

  describe("when a stopping version is given", () => {
    /** @scenario "With a stopping version neither goose pass goes past it" */
    it("stops both passes at it", () => {
      expect(goosePasses({ requiresDimensionCompat: true, upTo: 40 })).toEqual([
        { command: ["up-to", "40"], allowDimensionsOutsideSortingKey: true },
        { command: ["up-to", "40"], allowDimensionsOutsideSortingKey: false },
      ]);
      expect(goosePasses({ requiresDimensionCompat: true, upTo: 120 })).toEqual([
        { command: ["up-to", "86"], allowDimensionsOutsideSortingKey: true },
        { command: ["up-to", "120"], allowDimensionsOutsideSortingKey: false },
      ]);
      expect(goosePasses({ requiresDimensionCompat: false, upTo: 120 })).toEqual([
        { command: ["up-to", "120"], allowDimensionsOutsideSortingKey: false },
      ]);
    });
  });
});
