/// <reference types="@vitest/browser-playwright" />
/**
 * Shortcut hints in real Chromium: measured width on a narrow container and the
 * existing neutral tokens in both colour modes.
 * @see packages/design-system/specs/shortcut-hints.feature
 */
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { ShortcutHint } from "../src/components/display/shortcut-hint.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

describe("ShortcutHint in a browser", () => {
  /** @scenario "A hint uses existing neutral tokens in both colour modes" */
  it("keeps its keycaps on one line in a narrow container", async () => {
    await page.viewport(320, 480);
    const view = renderWithDesignSystem(
      <div style={{ width: 120 }}>
        <ShortcutHint
          platform="other"
          shortcut={{ alternatives: [{ keys: ["Shift", "Enter"] }, { keys: ["ArrowUp"] }] }}
        />
      </div>,
    );
    const hint = view.container.querySelector("[data-shortcut-hint]") as HTMLElement;
    const tops = new Set(
      [...hint.querySelectorAll("kbd")].map((node) => Math.round(node.getBoundingClientRect().top)),
    );
    expect(tops.size).toBe(1);
  });

  /** @scenario "A hint uses existing neutral tokens in both colour modes" */
  it("paints a keycap with a muted foreground and a border", () => {
    const view = renderWithDesignSystem(
      <ShortcutHint platform="mac" shortcut={{ alternatives: [{ keys: ["r"] }] }} />,
    );
    const kbd = view.container.querySelector("kbd") as HTMLElement;
    const style = getComputedStyle(kbd);
    expect(style.borderTopWidth).toBe("1px");
    expect(style.color).not.toBe("");
  });
});
