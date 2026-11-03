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

function rulesFor(element: HTMLElement) {
  const own = Array.from(element.classList).map((name) => `.${name}`);
  return Array.from(document.querySelectorAll("style"))
    .map((tag) => tag.textContent ?? "")
    .filter((css) => own.some((selector) => css.includes(selector)))
    .join("\n");
}

/** Splits css into the text inside `@media` blocks and everything outside them. */
function splitMedia(css: string) {
  let base = "";
  let media = "";
  let index = 0;
  while (index < css.length) {
    const start = css.indexOf("@media", index);
    if (start === -1) break;
    const open = css.indexOf("{", start);
    let depth = 1;
    let end = open + 1;
    while (depth > 0 && end < css.length) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") depth -= 1;
      end += 1;
    }
    base += css.slice(index, start);
    media += css.slice(start, end);
    index = end;
  }
  return { base: base + css.slice(index), media };
}

/**
 * Only drawers yield the docked side panel's room; a dialog stays centred in the whole window.
 */
describe("given a docked side panel reserves no room from a dialog", () => {
  afterEach(() => {
    setDrawerEndInset(0);
    cleanup();
  });

  /** @scenario "A modal dialog ignores a docked panel's room and stays centred" */
  it("adds no end padding to the dialog positioner", () => {
    setDrawerEndInset(412);
    const css = rulesFor(renderOpenDialog().parentElement as HTMLElement);
    // Anchor: the positioner's own rule must be found, or the negatives below pass vacuously.
    expect(css).toMatch(/justify-content:\s*center/);
    expect(css).not.toContain("412px");
    expect(css).not.toContain("padding-inline-end");
  });

  /** @scenario "A modal dialog ignores a docked panel's room and stays centred" */
  it("reduces the dialog's maximum width by the panel's width from md up", () => {
    setDrawerEndInset(412);
    const css = rulesFor(renderOpenDialog());
    const { base, media } = splitMedia(css);
    expect(media).toMatch(/min-width/);
    expect(media).toMatch(/max-width:\s*min\([^;]*calc\(100vw - 2rem - 412px\)/);
    expect(base).toMatch(/max-width:\s*min\([^;]*calc\(100vw - 2rem\)/);
    expect(base).not.toContain("412px");
  });
});
