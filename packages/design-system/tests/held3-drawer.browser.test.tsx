/// <reference types="@vitest/browser-playwright" />
/**
 * A drawer beside a docked or floating companion panel: the opt-in motion recipe, in real
 * Chromium, and the unchanged default.
 * @see packages/design-system/specs/overlay-shapes.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

beforeEach(async () => {
  await page.viewport(1000, 700);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function contentOf(motion?: "follow" | "wait") {
  renderWithDesignSystem(
    <Drawer open onClose={() => undefined} title="Companion" companionMotion={motion}>
      <p>Body</p>
    </Drawer>,
  );
  return getComputedStyle(screen.getByRole("dialog"));
}

describe("Drawer companionMotion", () => {
  /** @scenario "A drawer can follow or wait for a companion panel" */
  it("animates its margin over 240ms when it follows the companion", () => {
    const style = contentOf("follow");
    expect(style.transitionProperty).toContain("margin");
    expect(style.transitionDuration).toContain("0.24s");
  });

  /** @scenario "A drawer can follow or wait for a companion panel" */
  it("also delays its entrance 450ms when it waits for a floating companion", () => {
    const style = contentOf("wait");
    expect(style.transitionProperty).toContain("margin");
    expect(style.animationDelay).toContain("0.45s");
    expect(style.animationFillMode).toContain("backwards");
  });

  /** @scenario "A drawer can follow or wait for a companion panel" */
  it("keeps today's behaviour when the option is omitted", () => {
    const style = contentOf();
    expect(style.transitionProperty).not.toContain("margin");
    expect(style.animationDelay).not.toContain("0.45s");
  });
});
