import { describe, expect, it } from "vitest";

import { rawColourHints } from "../../../../model/dashboard-widget/widget-colour-hints.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../widgets/index.ts";

describe("the widget code the catalogue ships", () => {
  describe("given every catalogue widget that has code", () => {
    /** @scenario "The shipped widget code raises no colour hint" */
    it("finds no hard-coded colour in any of them", () => {
      for (const [id, build] of Object.entries(CATALOGUE_WIDGET_BUILDS)) {
        expect(rawColourHints(build.code.tsx), id).toEqual([]);
      }
    });
  });
});
