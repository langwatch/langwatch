/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { strictestLangWatchQLProtections } from "../langwatch-ql-query-scope.rules.ts";

describe("strictestLangWatchQLProtections", () => {
  /** @scenario "The query door redacts content to the strictest protection across the readable set" */
  it("offers a category only when every project grants it", () => {
    expect(
      strictestLangWatchQLProtections([
        { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true },
        { canSeeCosts: true, canSeeCapturedInput: false, canSeeCapturedOutput: null },
      ]),
    ).toEqual({ canSeeCosts: true, canSeeCapturedInput: false, canSeeCapturedOutput: false });
  });

  it("offers nothing for an empty readable set", () => {
    expect(strictestLangWatchQLProtections([])).toEqual({
      canSeeCosts: false,
      canSeeCapturedInput: false,
      canSeeCapturedOutput: false,
    });
  });
});
