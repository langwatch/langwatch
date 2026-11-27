import { describe, expect, it } from "vitest";

import { findableMarkup } from "../findable-markup.ts";

describe("findableMarkup", () => {
  /** @scenario "Find text inside collapsed panels with find-in-page" */
  it("hides a findable panel until found and leaves other hidden elements alone", () => {
    const html = [
      '<div data-part="item-content" data-docs-findable="" hidden="" role="region">Body</div>',
      '<div role="tabpanel" hidden="" data-docs-findable="">Tab</div>',
      '<div data-docs-findable="">Open</div>',
      '<div hidden="">Plain</div>',
    ].join("");
    expect(findableMarkup({ html })).toBe(
      [
        '<div data-part="item-content" data-docs-findable="" hidden="until-found" role="region">Body</div>',
        '<div role="tabpanel" hidden="until-found" data-docs-findable="">Tab</div>',
        '<div data-docs-findable="">Open</div>',
        '<div hidden="">Plain</div>',
      ].join(""),
    );
  });
});
