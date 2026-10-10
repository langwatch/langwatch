/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { strictestLangWatchQLProtections } from "../langwatch-ql-query-scope.rules.ts";

describe("strictestLangWatchQLProtections", () => {
  /** @scenario "The query door redacts content to the strictest protection across the readable set" */
  it("offers a category only when every project grants it", () => {
    expect(
      strictestLangWatchQLProtections([
        {
          catalogue: EVERY_CATALOGUE_PERMISSION,
          canSeeCosts: true,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
        },
        {
          catalogue: EVERY_CATALOGUE_PERMISSION,
          canSeeCosts: true,
          canSeeCapturedInput: false,
          canSeeCapturedOutput: null,
        },
      ]),
    ).toEqual({
      catalogue: EVERY_CATALOGUE_PERMISSION,
      canSeeCosts: true,
      canSeeCapturedInput: false,
      canSeeCapturedOutput: false,
    });
  });

  it("offers nothing for an empty readable set", () => {
    expect(strictestLangWatchQLProtections([])).toEqual({
      catalogue: { permissions: [] },
      canSeeCosts: false,
      canSeeCapturedInput: false,
      canSeeCapturedOutput: false,
    });
  });
});
