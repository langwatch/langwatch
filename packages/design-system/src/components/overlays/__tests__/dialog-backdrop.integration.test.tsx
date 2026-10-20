/**
 * @vitest-environment jsdom
 * @see specs/features/dialog-backdrop-transparency-blur.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { Dialog } from "../dialog.tsx";

function renderOpenDialog(backdropProps?: object) {
  renderWithDesignSystem(
    <Dialog.Root open>
      <Dialog.Content backdropProps={backdropProps}>
        <Dialog.Body>content</Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>,
  );
  const backdrop = document.querySelector<HTMLElement>("[data-part='backdrop']");
  if (!backdrop) throw new Error("backdrop not found");
  return backdrop;
}

function cssFor(element: HTMLElement) {
  const own = Array.from(element.classList).map((name) => `.${name}`);
  const css = Array.from(document.querySelectorAll("style"))
    .map((tag) => tag.textContent ?? "")
    .filter((text) => own.some((selector) => text.includes(selector)))
    .join("\n");
  // The recipe's own dark fill sits in @layer; only the unlayered rule wins.
  return css.split("@layer")[0] ?? "";
}

describe("Feature: Dialog backdrop transparency and blur", () => {
  afterEach(cleanup);

  /** @scenario "Dialog backdrop renders with blur and no dark fill" */
  it("Scenario: Dialog backdrop renders with blur and no dark fill", () => {
    const backdrop = renderOpenDialog();
    expect(backdrop).toHaveAttribute("data-lw-transparent-backdrop", "true");
    const css = cssFor(backdrop);
    expect(css).toMatch(/backdrop-filter:[^;]*blur/);
    expect(css).toMatch(/(^|;)background:var\(--chakra-colors-transparent\)/);
  });

  /** @scenario "Caller cannot override the backdrop with a dark fill" */
  it("Scenario: Caller cannot override the backdrop with a dark fill", () => {
    const backdrop = renderOpenDialog({
      bg: "blackAlpha.700",
      style: { backgroundColor: "black" },
    });
    expect(backdrop).toHaveAttribute("data-lw-transparent-backdrop", "true");
    const css = cssFor(backdrop);
    expect(css).toMatch(/(^|;)background:var\(--chakra-colors-transparent\)/);
    expect(css).not.toMatch(/blackAlpha|rgba\(0,\s*0,\s*0/i);
  });

  /** @scenario "Dialog.Backdrop is not exposed as a public sub-component" */
  it("Scenario: Dialog.Backdrop is not exposed as a public sub-component", () => {
    expect("Backdrop" in Dialog).toBe(false);
  });
});
