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

/**
 * A docked side panel does not offset the dialog's position; from md up it only narrows the
 * dialog's maximum width.
 */
describe("given a docked side panel only narrows a dialog's maximum width", () => {
  afterEach(() => {
    setDrawerEndInset(0);
    cleanup();
  });

  /** @scenario "A modal dialog stays centred while a docked panel only narrows it" */
  it("adds no end padding to the dialog positioner", () => {
    setDrawerEndInset(412);
    const css = cssTextOf(rulesFor(renderOpenDialog().parentElement as HTMLElement));
    // Anchor: the positioner's own rule must be found, or the negatives below pass vacuously.
    expect(css).toMatch(/justify-content:\s*center/);
    expect(css).not.toContain("412px");
    expect(css).not.toContain("padding-inline-end");
  });

  /** @scenario "A modal dialog stays centred while a docked panel only narrows it" */
  it("reduces the dialog's maximum width by the panel's width from md up", () => {
    setDrawerEndInset(412);
    const { base, media } = rulesFor(renderOpenDialog());
    const capped = media.find((entry) => entry.rule.style.maxWidth.includes("412px"));
    expect(capped?.mediaText).toMatch(/min-width/);
    expect(maxWidths(media.map((entry) => entry.rule))).toMatch(
      /min\([^;]*calc\(100vw - 2rem - 412px\)/,
    );
    expect(maxWidths(base)).toMatch(/min\([^;]*calc\(100vw - 2rem\)/);
    expect(maxWidths(base)).not.toContain("412px");
  });

  /** @scenario "A modal dialog stays centred while a docked panel only narrows it" */
  it("leaves the dialog's maximum width alone when no panel is docked", () => {
    setDrawerEndInset(0);
    const { base, media } = rulesFor(renderOpenDialog());
    expect(media.filter((entry) => entry.rule.style.maxWidth !== "")).toEqual([]);
    expect(maxWidths(base)).toMatch(/calc\(100vw - 2rem\)/);
  });
});
