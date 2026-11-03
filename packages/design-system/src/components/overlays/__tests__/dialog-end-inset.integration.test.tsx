/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { Dialog } from "../dialog.tsx";
import { setDrawerEndInset } from "../drawer.tsx";

function renderOpenDialog() {
  renderWithDesignSystem(
    <Dialog open onClose={() => undefined} title="Raw JSON" data-testid="dialog">
      body
    </Dialog>,
  );
  return screen.getByTestId("dialog");
}

interface MediaRule {
  rule: CSSStyleRule;
  mediaText: string;
}

interface ElementRules {
  base: CSSStyleRule[];
  media: MediaRule[];
}

/** Style rules naming the element's classes, split by whether an `@media` block holds them. */
function rulesFor(element: HTMLElement): ElementRules {
  const own = Array.from(element.classList).map((name) => `.${name}`);
  const found: ElementRules = { base: [], media: [] };
  const walk = (rules: CSSRule[], mediaText: string | null) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule && own.some((name) => rule.selectorText.includes(name))) {
        if (mediaText === null) found.base.push(rule);
        else found.media.push({ rule, mediaText });
      }
      if ("cssRules" in rule) {
        const enclosing = "media" in rule ? (rule as CSSMediaRule).media.mediaText : mediaText;
        walk([...(rule as CSSGroupingRule).cssRules], enclosing);
      }
    }
  };
  for (const sheet of document.styleSheets) walk([...sheet.cssRules], null);
  return found;
}

const cssTextOf = ({ base, media }: ElementRules) =>
  [...base, ...media.map((entry) => entry.rule)].map((rule) => rule.cssText).join("\n");

const maxWidths = (rules: CSSStyleRule[]) => rules.map((rule) => rule.style.maxWidth).join("\n");

/** A docked side panel changes neither the dialog's position nor its maximum width. */
describe("given a docked side panel a dialog ignores it", () => {
  afterEach(() => {
    setDrawerEndInset(0);
    cleanup();
  });

  /** @scenario "A modal dialog ignores a docked side panel" */
  it.each([412, 0])("adds no end padding to the dialog positioner at inset %i", (inset) => {
    setDrawerEndInset(inset);
    const css = cssTextOf(rulesFor(renderOpenDialog().parentElement as HTMLElement));
    // Anchor: the positioner's own rule must be found, or the negatives below pass vacuously.
    expect(css).toMatch(/justify-content:\s*center/);
    expect(css).not.toContain("412px");
    expect(css).not.toContain("padding-inline-end");
  });

  /** @scenario "A modal dialog ignores a docked side panel" */
  it.each([412, 0])("sets the maximum width in no media query at inset %i", (inset) => {
    setDrawerEndInset(inset);
    const { base, media } = rulesFor(renderOpenDialog());
    expect(maxWidths(base)).toMatch(/min\([^;]*calc\(100vw - 2rem\)/);
    expect(maxWidths(base)).not.toContain("412px");
    expect(media.filter((entry) => entry.rule.style.maxWidth !== "")).toEqual([]);
  });
});
