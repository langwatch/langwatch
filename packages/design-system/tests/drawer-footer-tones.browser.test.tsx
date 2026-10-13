/** Measured colour of tone-bearing secondary actions in real Chromium, both modes. */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const MODES = ["light", "dark"] as const;
const noop = () => undefined;

function setMode({ mode }: { mode: (typeof MODES)[number] }) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.style.colorScheme = mode;
}

beforeEach(async () => {
  await page.viewport(1000, 700);
});

afterEach(() => {
  cleanup();
  setMode({ mode: "light" });
});

function renderFooter() {
  renderWithDesignSystem(
    <Drawer
      onClose={noop}
      title="Group"
      footer={{
        secondaryActions: [
          { label: "Neutral", onClick: noop },
          { label: "Danger", tone: "danger", onClick: noop },
          { label: "Success", tone: "success", onClick: noop },
          { label: "Info", tone: "info", onClick: noop },
        ],
      }}
    />,
  );
  return screen.findByRole("dialog", { name: "Group" });
}

const style = (element: Element) => getComputedStyle(element);

describe("tone-bearing secondary actions in a browser", () => {
  for (const mode of MODES) {
    /** @scenario "A secondary action's tone colours its outline" */
    it(`colours text, border and hover per tone in ${mode} and keeps the neutral look`, async () => {
      setMode({ mode });
      const dialog = await renderFooter();
      await waitFor(() =>
        expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth),
      );
      const drawer = within(dialog);
      const get = (name: string) => drawer.getByRole("button", { name });
      const neutral = style(get("Neutral"));
      const seen = new Set<string>();
      for (const name of ["Danger", "Success", "Info"]) {
        const button = get(name);
        const css = style(button);
        expect(css.color).not.toBe(neutral.color);
        expect(css.borderTopColor).not.toBe(neutral.borderTopColor);
        expect(Number.parseFloat(css.borderTopWidth)).toBeGreaterThan(0);
        await waitFor(() => expect(style(button).backgroundColor).toBe("rgba(0, 0, 0, 0)"));
        seen.add(css.color);
        await userEvent.hover(button);
        await waitFor(() => expect(style(button).backgroundColor).not.toBe("rgba(0, 0, 0, 0)"));
      }
      expect(seen.size).toBe(3);
    });
  }

  /** @scenario "A secondary action's tone colours its outline" */
  it("keeps every label reachable at 320px without horizontal overflow", async () => {
    await page.viewport(320, 700);
    const drawer = await renderFooter();
    await waitFor(() => expect(drawer.getBoundingClientRect().left).toBeLessThanOrEqual(16));
    for (const name of ["Neutral", "Danger", "Success", "Info"]) {
      const rect = within(drawer).getByRole("button", { name }).getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(320);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  });
});
