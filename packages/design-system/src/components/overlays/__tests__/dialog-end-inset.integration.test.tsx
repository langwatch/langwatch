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
  return screen.getByTestId("dialog").parentElement as HTMLElement;
}

function rulesFor(element: HTMLElement) {
  const own = Array.from(element.classList).map((name) => `.${name}`);
  return Array.from(document.querySelectorAll("style"))
    .map((tag) => tag.textContent ?? "")
    .filter((css) => own.some((selector) => css.includes(selector)))
    .join("\n");
}

/**
 * Only drawers yield the docked side panel's room; a dialog stays centred in the whole window.
 */
describe("given a docked side panel keeps room on the right edge", () => {
  afterEach(() => {
    setDrawerEndInset(0);
    cleanup();
  });

  it("keeps the dialog centred in the whole window, since only drawers make room for the panel", () => {
    setDrawerEndInset(412);
    const css = rulesFor(renderOpenDialog());
    expect(css).not.toContain("412px");
    expect(css).not.toContain("padding-inline-end");
  });

  it("keeps the full window when no panel is docked", () => {
    expect(rulesFor(renderOpenDialog())).not.toContain("padding-inline-end:412px");
  });
});
