import { describe, expect, it } from "vitest";

import { SETTINGS_MEASURE, settingsColumnCss } from "../settings-column.ts";

const BODY = "& [data-page-header] ~ :not(button), &:not(:has([data-page-header])) > :not(button)";

describe("the settings column", () => {
  /** @scenario "On a wide window the column sits in the middle" */
  it("centres the body in one column with equal space either side", () => {
    const body = settingsColumnCss()[BODY];
    expect(body?.marginInline).toBe("auto");
    expect(body?.width).toBe(`min(${SETTINGS_MEASURE}, calc(100% - 2 * var(--page-inset)))`);
  });

  /** @scenario "On a wide window the column sits in the middle" */
  it("insets the header's words to the column's edges, never closer than the page inset", () => {
    const header = settingsColumnCss()["& [data-page-header]"];
    expect(header?.paddingInline).toBe(
      `max(var(--page-inset), calc((100% - ${SETTINGS_MEASURE}) / 2))`,
    );
    // The rule is the header's own border, so padding (not width or margin) keeps it full width.
    expect(header).not.toHaveProperty("width");
    expect(header).not.toHaveProperty("marginInline");
  });
});
